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

    const snapshot = report.snapshot as any;
    return {
      id: report.id,
      reportNumber: report.reportNumber,
      version: report.currentVersion,
      finalizedAt: report.finalizedAt,
      finalizedBy: report.finalizedBy,
      ...snapshot,
    };
  }

  async generatePdf(currentUser: AuthUser, orderId: string): Promise<Buffer> {
    const data = await this.getReport(currentUser, orderId);

    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 168, bottom: 82, left: 38, right: 38 },
        bufferPages: true,
        autoFirstPage: true,
      });
      const chunks: Buffer[] = [];

      return await new Promise<Buffer>((resolve, reject) => {
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('error', reject);

        const text = (value: unknown) => String(value ?? '');
        const date = (value: unknown) => {
          if (!value) return 'N/A';
          const parsed = new Date(String(value));
          return Number.isNaN(parsed.getTime())
            ? 'N/A'
            : parsed.toLocaleString('en-IN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              });
        };

        const patient = data.order?.patient ?? {};
        const samples = Array.isArray(data.order?.samples) ? data.order.samples : [];
        const firstSample = samples[0] ?? {};
        const lab = data.lab ?? {};

        const drawTopHeader = () => {
          const left = 38;
          const right = 557;
          const top = 8;

          doc.font('Helvetica-Bold').fontSize(8.5);
          doc.text(text(lab.name || 'LABORATORY'), 365, top, {
            width: 192,
            align: 'left',
            lineGap: 0,
          });
          doc.font('Helvetica').fontSize(8);
          doc.text(text(lab.address || ''), 365, top + 12, {
            width: 192,
            lineGap: 0,
          });
          doc.text(`Mob: ${text(lab.mobile || '')}`, 365, top + 24, {
            width: 192,
            lineGap: 0,
          });
          doc.text(`E-mail: ${text(lab.email || '')}`, 365, top + 36, {
            width: 192,
            lineGap: 0,
          });

          const boxTop = 110;
          const boxBottom = 205;
          doc.rect(left, boxTop, right - left, boxBottom - boxTop).stroke();

          doc.font('Helvetica').fontSize(8.5);
          const row = (label: string, value: string, x: number, y: number, width = 170) => {
            doc.text(label, x, y, { width: 110 });
            doc.text(':', x + 108, y);
            doc.font('Helvetica-Bold').text(value, x + 120, y, { width });
            doc.font('Helvetica');
          };

          row('Patient Name', text(patient.name), 47, 124);
          row(
            'Age/Gender',
            `${text(patient.age ?? 'N/A')} Year /${text(patient.gender ?? 'N/A')}`,
            47,
            141,
          );
          row('Ref Doctor', text(data.order?.referredBy || 'DR.SELF'), 47, 158);
          row('Lab ID', text(data.order?.orderNumber || data.reportNumber), 47, 175);
          row('Client Name/Code', `${text(lab.name)} (${text(lab.code)})`, 47, 192, 220);
          row('Referring customer', text(data.order?.referredBy || ''), 47, 209);

          row('Registration', date(data.order?.orderedAt), 285, 124, 170);
          row('Collected Date', date(firstSample.collectedAt), 285, 141, 170);
          row('Reported Date', date(data.finalizedAt), 285, 158, 170);
          row(
            'Barcode No',
            text(firstSample.accessionNumber || data.order?.orderNumber || ''),
            285,
            175,
            170,
          );
          row('Report Status', 'Final', 285, 192, 170);

          doc.moveTo(left, 218).lineTo(right, 218).stroke();
          doc.font('Helvetica-Bold').fontSize(8.5);
          doc.text('TEST DESCRIPTION', left, 224, { width: 205 });
          doc.text('RESULT ENTRY', 265, 224, { width: 92, align: 'center' });
          doc.text('FLAG', 358, 224, { width: 50, align: 'center' });
          doc.text('BIO. REF. RANGE', 405, 224, { width: 105 });
          doc.text('UNIT', 515, 224, { width: 42 });
          doc.moveTo(left, 239).lineTo(right, 239).stroke();
        };

        const drawFooter = () => {
          const pageHeight = doc.page.height;
          const footerY = pageHeight - 62;
          doc.font('Helvetica').fontSize(6.5);
          doc.text('*This report is not used for medico legal purpose.', 40, footerY, { width: 245 });
          doc.text(
            '*This is a computer-generated report and does not require a signature.',
            40,
            footerY + 11,
            { width: 290 },
          );
          doc.text('*Please correlate with clinical conditions.', 40, footerY + 22, { width: 245 });

          doc.font('Helvetica-Bold').fontSize(8);
          doc.text(text(lab.name || 'LABORATORY'), 250, footerY - 3, {
            width: 190,
            align: 'center',
          });
          doc.font('Helvetica').fontSize(7);
          doc.text(text(lab.address || ''), 250, footerY + 9, {
            width: 190,
            align: 'center',
          });
          doc.text(text(lab.email || ''), 250, footerY + 20, {
            width: 190,
            align: 'center',
          });

          doc.font('Helvetica-Bold').fontSize(7.5);
          doc.text(`Dr. ${text(data.finalizedBy?.username || '')}`, 395, footerY - 1, {
            width: 120,
            align: 'center',
          });
          doc.font('Helvetica').fontSize(7);
          doc.text('Consultant Pathologist', 395, footerY + 12, {
            width: 120,
            align: 'center',
          });
        };

        const startNewPage = () => {
          doc.addPage();
          drawTopHeader();
          doc.y = 247;
        };

        drawTopHeader();
        doc.y = 247;

        const usableBottom = () => doc.page.height - 92;
        const ensureSpace = (height: number) => {
          if (doc.y + height > usableBottom()) startNewPage();
        };

        const formatReferenceRange = (parameter: any) => {
          const range = parameter.referenceRange;
          if (typeof range === 'string') return range;
          if (range && typeof range === 'object') {
            if (range.displayRange) return String(range.displayRange);
            if (range.low != null && range.high != null) return `${range.low} - ${range.high}`;
            if (range.low != null) return `>= ${range.low}`;
            if (range.high != null) return `<= ${range.high}`;
          }
          if (parameter.normalMin != null && parameter.normalMax != null) {
            return `${parameter.normalMin} - ${parameter.normalMax}`;
          }
          if (parameter.normalMin != null) return `>= ${parameter.normalMin}`;
          if (parameter.normalMax != null) return `<= ${parameter.normalMax}`;
          return '';
        };

        const formatValue = (parameter: any) => {
          const value = parameter.value;
          return value == null || String(value).trim() === '' ? '' : String(value);
        };

        const flagText = (flag: unknown) => {
          if (flag === 'LOW') return 'L ↓';
          if (flag === 'HIGH') return 'H ↑';
          return '';
        };

        const departmentPrinted = new Set<string>();
        const tests = Array.isArray(data.order?.tests) ? data.order.tests : [];

        tests.forEach((test: any, testIndex: number) => {
          const department = text(test.test?.department || test.test?.category || 'LABORATORY');
          const testName = text(test.test?.name || 'Laboratory Test');
          const sampleType = text(test.test?.sampleType || firstSample.specimenType || '');

          ensureSpace(42);
          if (!departmentPrinted.has(department)) {
            doc.font('Helvetica-Bold').fontSize(9.5).text(department, 38, doc.y, {
              width: 519,
              align: 'center',
            });
            departmentPrinted.add(department);
          }

          doc.font('Helvetica-Bold').fontSize(9.5).text(testName, 120, doc.y, {
            width: 300,
            align: 'center',
          });

          if (sampleType) {
            doc.font('Helvetica').fontSize(7).text(`Sample Type: ${sampleType}`, 38, doc.y + 1, {
              width: 150,
            });
          }
          doc.moveDown(0.35);

          const method = text(test.test?.method || '');
          const parameters = Array.isArray(test.parameters) ? test.parameters : [];

          parameters.forEach((parameter: any, parameterIndex: number) => {
            const parameterName = text(parameter.name);
            const value = formatValue(parameter);
            const ref = formatReferenceRange(parameter);
            const unit = text(parameter.unit || '');
            const flag = flagText(parameter.flag);

            ensureSpace(31);

            const xName = parameterIndex === 0 ? 38 : 58;
            const nameWidth = 210;
            const resultX = 265;
            const flagX = 358;
            const rangeX = 405;
            const unitX = 515;
            const abnormal = parameter.flag && parameter.flag !== 'NORMAL';

            doc.font(abnormal ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(8.5)
              .text(parameterName, xName, doc.y, { width: nameWidth, lineGap: 0 });
            doc.font(abnormal ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(8.5)
              .text(value, resultX, doc.y, { width: 86, align: 'left', lineGap: 0 });
            doc.font('Helvetica-Bold').fontSize(8.5).text(flag, flagX, doc.y, {
              width: 45,
              align: 'center',
              lineGap: 0,
            });
            doc.font('Helvetica-Bold').fontSize(8.5).text(ref, rangeX, doc.y, {
              width: 105,
              lineGap: 0,
            });
            doc.font('Helvetica-Bold').fontSize(8.5).text(unit, unitX, doc.y, {
              width: 42,
              lineGap: 0,
            });
            doc.moveDown(0.05);

            if (method && parameterIndex === 0) {
              doc.font('Helvetica').fontSize(6.2).text(`METHOD : ${method.toUpperCase()}`, xName, doc.y, {
                width: 230,
                lineGap: 0,
              });
              doc.moveDown(0.05);
            }
          });

          const interpretation = test.test?.interpretation || test.test?.remarks;
          if (interpretation) {
            ensureSpace(35);
            doc.font('Helvetica-Bold').fontSize(8).text('Interpretation:', 38, doc.y + 3);
            doc.font('Helvetica').fontSize(7).text(text(interpretation), 38, doc.y + 13, {
              width: 519,
              lineGap: 1,
            });
            doc.moveDown(0.35);
          }

          if (testIndex < tests.length - 1) doc.moveDown(0.25);
        });

        if (data.order?.clinicalNotes) {
          ensureSpace(35);
          doc.font('Helvetica-Bold').fontSize(8).text('Clinical Notes:', 38, doc.y + 3);
          doc.font('Helvetica').fontSize(7).text(text(data.order.clinicalNotes), 38, doc.y + 13, {
            width: 519,
            lineGap: 1,
          });
        }

        ensureSpace(78);
        const signatureY = doc.page.height - 180;
        doc.font('Helvetica').fontSize(7);
        doc.text(text(lab.name || 'LABORATORY'), 40, signatureY + 48, {
          width: 180,
          align: 'center',
        });
        doc.text(text(lab.address || ''), 40, signatureY + 60, {
          width: 180,
          align: 'center',
        });
        doc.font('Helvetica-Bold').fontSize(8);
        doc.text(`Dr. ${text(data.finalizedBy?.username || '')}`, 330, signatureY + 48, {
          width: 190,
          align: 'center',
        });
        doc.font('Helvetica').fontSize(7);
        doc.text('Consultant Pathologist', 330, signatureY + 62, {
          width: 190,
          align: 'center',
        });

        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i += 1) {
          doc.switchToPage(i);
          drawFooter();
          doc.font('Helvetica').fontSize(7);
          doc.text(`${i - range.start + 1} / ${range.count}`, 490, doc.page.height - 25, {
            width: 65,
            align: 'right',
          });
        }

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
      if (
        !(await this.prisma.finalReport.findUnique({
          where: { reportNumber },
          select: { id: true },
        }))
      ) {
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
