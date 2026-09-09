import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditAction, OrderStatus, SampleStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FinalReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async finalize(currentUser: AuthUser, orderId: string) {
    const order = await this.getOrder(currentUser, orderId);
    if (order.status === OrderStatus.FINAL) return this.getReport(currentUser, orderId);
    if (order.status !== OrderStatus.VERIFIED) {
      throw new BadRequestException('Only verified orders can be finalized');
    }
    if (!order.items.length) throw new BadRequestException('Order has no tests');
    if (!order.samples.length) throw new BadRequestException('Order has no samples');

    const missing: string[] = [];
    for (const item of order.items) {
      for (const parameter of item.test.parameters) {
        const result = item.results.find((row) => row.parameterId === parameter.id);
        if (parameter.isRequired && (!result || !result.value.trim())) {
          missing.push(`${item.test.name}: ${parameter.name}`);
        }
      }
    }
    if (missing.length) {
      throw new BadRequestException(`Missing required results: ${missing.join(', ')}`);
    }

    const incompleteSamples = order.samples.filter(
      (sample) => sample.status !== SampleStatus.COMPLETED,
    );
    if (incompleteSamples.length) {
      throw new BadRequestException(
        `All samples must be completed before finalization: ${incompleteSamples
          .map((sample) => sample.accessionNumber)
          .join(', ')}`,
      );
    }

    const lab = await this.prisma.lab.findUnique({
      where: { id: currentUser.labId },
      select: {
        id: true,
        code: true,
        name: true,
        mobile: true,
        email: true,
        address: true,
        icon: true,
      },
    });
    if (!lab) throw new NotFoundException('Lab not found');

    const finalizedAt = new Date();
    const reportNumber = await this.createReportNumber(lab.code);
    const snapshot = this.buildSnapshot(lab, order, finalizedAt);

    const report = await this.prisma.$transaction(async (tx) => {
      const created = await tx.finalReport.upsert({
        where: { orderId: order.id },
        create: {
          labId: currentUser.labId,
          orderId: order.id,
          reportNumber,
          finalizedById: currentUser.id,
          finalizedAt,
          snapshot,
          currentVersion: 1,
        },
        update: {},
      });

      await tx.finalReportVersion.upsert({
        where: { finalReportId_version: { finalReportId: created.id, version: 1 } },
        create: {
          finalReportId: created.id,
          version: 1,
          snapshot,
          amendmentReason: 'Initial finalization',
          createdById: currentUser.id,
        },
        update: {},
      });

      await tx.labOrder.updateMany({
        where: {
          id: order.id,
          labId: currentUser.labId,
          status: OrderStatus.VERIFIED,
        },
        data: { status: OrderStatus.FINAL },
      });
      return created;
    });

    await this.audit.record(
      currentUser,
      AuditAction.FINALIZE,
      'FinalReport',
      report.id,
      { orderId, reportNumber, version: 1 },
    );
    return this.getReport(currentUser, orderId);
  }

  async amend(currentUser: AuthUser, orderId: string, reasonValue: unknown) {
    const reason = typeof reasonValue === 'string' ? reasonValue.trim() : '';
    if (reason.length < 5 || reason.length > 500) {
      throw new BadRequestException('Amendment reason must be between 5 and 500 characters');
    }

    const existing = await this.prisma.finalReport.findFirst({
      where: { orderId, labId: currentUser.labId },
    });
    if (!existing) throw new NotFoundException('Final report not found');

    const order = await this.getOrder(currentUser, orderId);
    const lab = await this.prisma.lab.findUnique({
      where: { id: currentUser.labId },
      select: {
        id: true,
        code: true,
        name: true,
        mobile: true,
        email: true,
        address: true,
        icon: true,
      },
    });
    if (!lab) throw new NotFoundException('Lab not found');

    const amendedAt = new Date();
    const nextVersion = existing.currentVersion + 1;
    const snapshot = this.buildSnapshot(lab, order, amendedAt);
    const updated = await this.prisma.$transaction(async (tx) => {
      const version = await tx.finalReportVersion.create({
        data: {
          finalReportId: existing.id,
          version: nextVersion,
          snapshot,
          amendmentReason: reason,
          createdById: currentUser.id,
        },
      });
      await tx.finalReport.update({
        where: { id: existing.id },
        data: {
          snapshot,
          currentVersion: nextVersion,
          finalizedById: currentUser.id,
          finalizedAt: amendedAt,
        },
      });
      return version;
    });

    await this.audit.record(
      currentUser,
      AuditAction.AMEND,
      'FinalReport',
      existing.id,
      { orderId, version: nextVersion, reason },
    );

    return {
      ...this.getReportShape(existing),
      version: updated.version,
      amendedAt: updated.createdAt,
      amendmentReason: reason,
    };
  }

  async listVersions(currentUser: AuthUser, orderId: string) {
    const report = await this.prisma.finalReport.findFirst({
      where: { orderId, labId: currentUser.labId },
      select: { id: true },
    });
    if (!report) throw new NotFoundException('Final report not found');

    return this.prisma.finalReportVersion.findMany({
      where: { finalReportId: report.id },
      include: {
        createdBy: { select: { id: true, username: true, role: true } },
      },
      orderBy: { version: 'desc' },
    });
  }

  async getReport(currentUser: AuthUser, orderId: string) {
    const report = await this.prisma.finalReport.findFirst({
      where: { orderId, labId: currentUser.labId },
      include: {
        finalizedBy: { select: { id: true, username: true, role: true } },
      },
    });
    if (!report) throw new NotFoundException('Final report not found');

    return {
      id: report.id,
      reportNumber: report.reportNumber,
      version: report.currentVersion,
      finalizedAt: report.finalizedAt,
      finalizedBy: report.finalizedBy,
      ...(report.snapshot as object),
    };
  }

  async generatePdf(currentUser: AuthUser, orderId: string): Promise<Buffer> {
    const data = await this.getReport(currentUser, orderId);
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 42 });
      const chunks: Buffer[] = [];

      return await new Promise<Buffer>((resolve, reject) => {
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const text = (value: unknown) => String(value ?? '');
        const date = (value: unknown) => {
          if (!value) return 'N/A';
          const parsed = new Date(String(value));
          return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleString('en-IN');
        };

        doc.font('Helvetica-Bold').fontSize(18).text(text(data.lab?.name || 'Laboratory'), {
          align: 'center',
        });
        doc.font('Helvetica').fontSize(8).text(text(data.lab?.address || ''), {
          align: 'center',
        });
        doc.text(
          `${text(data.lab?.mobile || '')}${data.lab?.email ? ` | ${text(data.lab.email)}` : ''}`,
          { align: 'center' },
        );
        doc.moveDown();
        doc.font('Helvetica-Bold').fontSize(12).text('FINAL LABORATORY REPORT');
        doc.font('Helvetica').fontSize(9);
        doc.text(`Report No: ${text(data.reportNumber)}`);
        doc.text(`Version: ${text(data.version)}`);
        doc.text(`Patient: ${text(data.order?.patient?.name)}`);
        doc.text(`Age / Gender: ${text(data.order?.patient?.age ?? 'N/A')} / ${text(data.order?.patient?.gender ?? 'N/A')}`);
        doc.text(`Mobile: ${text(data.order?.patient?.mobile || 'N/A')}`);
        doc.text(`Reported: ${date(data.finalizedAt)}`);
        doc.moveDown();

        const tests = Array.isArray(data.order?.tests) ? data.order.tests : [];
        tests.forEach((test: any, testIndex: number) => {
          if (testIndex > 0) doc.moveDown();
          doc.font('Helvetica-Bold').fontSize(11).text(text(test.test?.name || 'Laboratory Test'));
          doc.font('Helvetica').fontSize(8).text(
            `${text(test.test?.department || test.test?.category || '')}${test.test?.sampleType ? ` | Specimen: ${text(test.test.sampleType)}` : ''}`,
          );
          doc.moveDown(0.3);

          const rows = Array.isArray(test.parameters) ? test.parameters : [];
          rows.forEach((parameter: any) => {
            const range = parameter.referenceRange;
            const rangeText =
              typeof range === 'string'
                ? range
                : range && typeof range === 'object'
                  ? `${range.low ?? parameter.normalMin ?? ''}${range.high != null ? ` - ${range.high}` : ''}`
                  : `${parameter.normalMin ?? ''}${parameter.normalMax != null ? ` - ${parameter.normalMax}` : ''}`;
            doc.font('Helvetica').fontSize(8).text(
              `${text(parameter.name)}: ${text(parameter.value ?? 'N/A')} ${text(parameter.unit || '')}  Ref: ${rangeText || '—'}  ${text(parameter.flag || '')}`,
            );
          });
        });

        doc.moveDown();
        if (data.order?.clinicalNotes) {
          doc.font('Helvetica-Bold').fontSize(9).text('Clinical Notes');
          doc.font('Helvetica').fontSize(8).text(text(data.order.clinicalNotes));
        }
        doc.moveDown();
        doc.font('Helvetica').fontSize(7).text(
          `Report ${text(data.reportNumber)} | Generated by the laboratory reporting system | ${date(new Date())}`,
          { align: 'center' },
        );
        doc.end();
      });
    } catch {
      throw new ServiceUnavailableException('PDF generation is temporarily unavailable');
    }
  }

  private getReportShape(report: any) {
    return {
      id: report.id,
      reportNumber: report.reportNumber,
      version: report.currentVersion,
      finalizedAt: report.finalizedAt,
    };
  }

  private async createReportNumber(labCode: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
      const random = Math.random().toString(36).slice(2, 8).toUpperCase();
      const reportNumber = `${labCode}-R-${timestamp}-${random}`;
      if (!(await this.prisma.finalReport.findUnique({ where: { reportNumber }, select: { id: true } }))) {
        return reportNumber;
      }
    }
    throw new BadRequestException('Unable to allocate a unique report number');
  }

  private async getOrder(currentUser: AuthUser, orderId: string) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id: orderId, labId: currentUser.labId },
      include: {
        patient: true,
        samples: true,
        items: {
          include: {
            test: {
              include: { parameters: { orderBy: { displayOrder: 'asc' } } },
            },
            results: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private buildSnapshot(lab: any, order: any, finalizedAt: Date) {
    return {
      lab,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: OrderStatus.FINAL,
        referredBy: order.referredBy,
        clinicalNotes: order.clinicalNotes,
        orderedAt: order.orderedAt,
        patient: order.patient,
        samples: order.samples,
        tests: order.items.map((item: any) => ({
          orderItemId: item.id,
          test: {
            id: item.test.id,
            code: item.test.code,
            name: item.test.name,
            category: item.test.category,
            department: item.test.department,
            sampleType: item.test.sampleType,
            method: item.test.method,
          },
          parameters: item.test.parameters.map((parameter: any) => {
            const result = item.results.find((row: any) => row.parameterId === parameter.id);
            const historicalRange = result?.referenceRangeSnapshot ?? null;
            return {
              parameterId: parameter.id,
              name: parameter.name,
              value: result?.value ?? null,
              unit: historicalRange?.unit ?? parameter.unit,
              referenceRange: historicalRange ?? parameter.referenceRange,
              referenceRangeId: result?.referenceRangeId ?? null,
              referenceRangeVersion: historicalRange?.version ?? null,
              normalMin: historicalRange?.low ?? parameter.normalMin,
              normalMax: historicalRange?.high ?? parameter.normalMax,
              flag: result?.flag ?? null,
              displayOrder: parameter.displayOrder,
            };
          }),
        })),
      },
      finalizedAt,
    };
  }
}
