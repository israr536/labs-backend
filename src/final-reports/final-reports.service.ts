import {
  BadRequestException,
  ConflictException,
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

  async finalize(currentUser: AuthUser, orderId: string, loadedOrder?: any) {
    const order = loadedOrder ?? (await this.getOrder(currentUser, orderId));
    const existingReport = await this.prisma.finalReport.findFirst({
      where: { orderId: order.id, labId: currentUser.labId },
    });
    if (existingReport) return this.getReport(currentUser, orderId);
    if (
      order.status !== OrderStatus.VERIFIED &&
      order.status !== OrderStatus.FINAL
    ) {
      throw new BadRequestException('Only verified orders can be finalized');
    }
    if (!order.items.length) throw new BadRequestException('Order has no tests');
    if (!order.samples.length) throw new BadRequestException('Order has no samples');

    const missing: string[] = [];
    for (const item of order.items) {
      // const resultsByParameterId = new Map(item.results.map((row) => [row.parameterId, row]));
      const resultsByParameterId = new Map<string, any>(
  item.results.map((row: any) => [row.parameterId, row]),
);
      for (const parameter of item.test.parameters) {
        const result = resultsByParameterId.get(parameter.id);
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

   const lab = order.lab ?? (await this.prisma.lab.findUnique({
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
}));

if (!lab) throw new NotFoundException('Lab not found');

const finalizedAt = new Date();
const reportNumber = this.createReportNumber(lab.code);
    const snapshot = this.buildSnapshot(lab, order, finalizedAt);

    const report = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.labOrder.updateMany({
        where: {
          id: order.id,
          labId: currentUser.labId,
          status: { in: [OrderStatus.VERIFIED, OrderStatus.FINAL] },
        },
        data: { status: OrderStatus.FINAL },
      });
      if (claimed.count !== 1) throw new ConflictException('Order finalization was already completed or changed. Reload the order.');

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

      return created;
    });

    await this.audit.record(
      currentUser,
      AuditAction.FINALIZE,
      'FinalReport',
      report.id,
      { orderId, reportNumber, version: 1 },
    );

    return {
      ...snapshot,
      id: report.id,
      reportNumber: report.reportNumber,
      version: report.currentVersion,
      finalizedAt: report.finalizedAt,
      finalizedBy: { id: currentUser.id, username: (currentUser as any).username, role: currentUser.role },
    };
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
    if (!report) {
      const order = await this.getOrder(currentUser, orderId);
      if (order.status === OrderStatus.FINAL) {
        return this.finalize(currentUser, orderId, order);
      }
      throw new NotFoundException('Final report not found');
    }

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
      const LEFT = 12;
      const RIGHT = 583;
      const CONTENT_TOP = 246;
      const CONTENT_BOTTOM = 636;

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        bufferPages: true,
        autoFirstPage: true,
      });
      const chunks: Buffer[] = [];

      return await new Promise<Buffer>((resolve, reject) => {
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('error', reject);

        const text = (value: unknown) => String(value ?? '');
        const patient = data.order?.patient ?? {};
        const samples = Array.isArray(data.order?.samples) ? data.order.samples : [];
        const firstSample = samples[0] ?? {};
        const lab = data.lab ?? {};
        const tests = Array.isArray(data.order?.tests) ? data.order.tests : [];

        const formatDate = (value: unknown) => {
          if (!value) return '';
          const parsed = new Date(String(value));
          if (Number.isNaN(parsed.getTime())) return '';
          const dd = String(parsed.getDate()).padStart(2, '0');
          const mm = String(parsed.getMonth() + 1).padStart(2, '0');
          const yyyy = parsed.getFullYear();
          let hour = parsed.getHours();
          const suffix = hour >= 12 ? 'PM' : 'AM';
          hour %= 12;
          if (hour === 0) hour = 12;
          return `${dd}/${mm}/${yyyy} ${String(hour).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')} ${suffix}`;
        };

        const formatGender = (value: unknown) => {
          const v = text(value).toLowerCase();
          return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'N/A';
        };

        const drawBarcode = (value: string, x: number, y: number, width = 86, height = 21) => {
          const digits = value.replace(/\D/g, '') || '000000';
          const digitPatterns = [
            '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
            '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
          ];
          const pattern = `11010010000${digits.slice(0, 12).split('').map((d) => digitPatterns[Number(d)]).join('')}1100011101011`;
          const unit = width / pattern.length;
          for (let i = 0; i < pattern.length; i += 1) {
            if (pattern[i] === '1') doc.rect(x + i * unit, y, Math.max(unit, 0.55), height).fill();
          }
        };

        const drawHeader = (withBarcode = false) => {
          doc.font('Helvetica-Bold').fontSize(7.4);
          doc.text(text(lab.name || 'LABORATORY').toUpperCase(), 388, 7, { width: 190, lineGap: 0 });
          doc.font('Helvetica').fontSize(6.7);
          doc.text(text(lab.address || ''), 388, 18, { width: 190, lineGap: 0 });
          doc.text(`Mob: ${text(lab.mobile || '')}`, 388, 28, { width: 190, lineGap: 0 });
          doc.text(`E-mail: ${text(lab.email || '')}`, 388, 38, { width: 190, lineGap: 0 });

          const boxTop = 105;
          const boxBottom = 210;
          doc.lineWidth(0.65).rect(LEFT, boxTop, RIGHT - LEFT, boxBottom - boxTop).stroke();

          const row = (label: string, value: string, x: number, y: number, valueWidth: number) => {
            doc.font('Helvetica').fontSize(8.2);
            doc.text(label, x, y, { width: 106, lineGap: 0 });
            doc.text(':', x + 108, y, { width: 7, lineGap: 0 });
            doc.font('Helvetica-Bold').fontSize(8.2);
            doc.text(value, x + 120, y, { width: valueWidth, lineGap: 0 });
          };

          row('Patient Name', text(patient.name), 21, 119, 225);
          row('Age/Gender', `${text(patient.age ?? 'N/A')} Year /${formatGender(patient.gender)}`, 21, 135, 225);
          row('Ref Doctor', text(data.order?.referredBy || 'DR.SELF'), 21, 151, 225);
          row('Lab ID', text(data.order?.orderNumber || data.reportNumber), 21, 167, 225);
          row('Client Name/Code', `${text(lab.name)} (${text(lab.code)})`, 21, 183, 225);
          row('Referring customer', text(data.order?.referredBy || ''), 21, 199, 225);

          row('Registration', formatDate(data.order?.orderedAt), 302, 119, 220);
          row('Collected Date', formatDate(firstSample.collectedAt), 302, 135, 220);
          row('Reported Date', formatDate(data.finalizedAt), 302, 151, 220);
          row('Barcode No', text(firstSample.accessionNumber || data.order?.orderNumber || ''), 302, 167, 220);
          row('Report Status', 'Final', 302, 183, 220);

          doc.lineWidth(0.7).moveTo(LEFT, 219).lineTo(RIGHT, 219).stroke();
          doc.font('Helvetica-Bold').fontSize(8.3);
          doc.text('TEST DESCRIPTION', 13, 227, { width: 215, lineGap: 0 });
          doc.text('RESULT ENTRY', 235, 227, { width: 102, align: 'center', lineGap: 0 });
          doc.text('FLAG', 346, 227, { width: 44, align: 'center', lineGap: 0 });
          doc.text('BIO. REF. RANGE', 399, 227, { width: 102, lineGap: 0 });
          doc.text('UNIT', 507, 227, { width: 52, lineGap: 0 });
          doc.lineWidth(0.7).moveTo(LEFT, 240).lineTo(RIGHT, 240).stroke();

          if (withBarcode) drawBarcode(text(firstSample.accessionNumber || data.order?.orderNumber || data.reportNumber), 499, 250, 75, 20);
        };

        const drawVerificationMark = (pageNumber: number) => {
          const barcodeValue = text(firstSample.accessionNumber || data.order?.orderNumber || data.reportNumber);
          const seed = barcodeValue.split('').reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 17);
          const qrX = 33;
          const qrY = 673;
          const cell = 3;
          for (let r = 0; r < 21; r += 1) {
            for (let c = 0; c < 21; c += 1) {
              const finder = (ox: number, oy: number) => {
                const dx = c - ox;
                const dy = r - oy;
                if (dx < 0 || dx > 6 || dy < 0 || dy > 6) return false;
                return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
              };
              const isFinder = finder(0, 0) || finder(14, 0) || finder(0, 14);
              const pseudo = ((seed + r * 92821 + c * 68917 + r * c * 97 + pageNumber * 13) >>> 0) % 7 < 3;
              if (isFinder || pseudo) doc.rect(qrX + c * cell, qrY + r * cell, cell, cell).fill();
            }
          }
        };

        const drawFooter = (pageNumber: number, totalPages: number) => {
          drawVerificationMark(pageNumber);

          doc.font('Helvetica').fontSize(6.3);
          doc.text('*Please correlate with clinical conditions.', 39, 733, { width: 245, lineGap: 0 });
          doc.text('*This report is not used for medico legal purpose.', 39, 745, { width: 260, lineGap: 0 });
          doc.text('*This is a computer-generated report and does not require a signature.', 39, 757, { width: 285, lineGap: 0 });

          doc.font('Helvetica-Bold').fontSize(7.6);
          doc.text(`Dr. ${text(data.finalizedBy?.username || '')}`, 270, 704, { width: 150, align: 'center', lineGap: 0 });
          doc.font('Helvetica').fontSize(6.8);
          doc.text('Consultant Pathologist', 270, 716, { width: 150, align: 'center', lineGap: 0 });

          doc.font('Helvetica').fontSize(7);
          doc.text(`${pageNumber} / ${totalPages}`, 505, 806, { width: 65, align: 'right', lineGap: 0 });
        };

        const startPage = () => {
          doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
          drawHeader(false);
          return CONTENT_TOP;
        };

        let cursorY = CONTENT_TOP;
        drawHeader(true);

        const ensureSpace = (height: number) => {
          if (cursorY + height <= CONTENT_BOTTOM) return;
          cursorY = startPage();
        };

        const rangeText = (parameter: any) => {
          const range = parameter.referenceRange;
          if (typeof range === 'string') return range;
          if (range && typeof range === 'object') {
            if (range.displayRange) return String(range.displayRange);
            if (range.low != null && range.high != null) return `${range.low} - ${range.high}`;
            if (range.low != null) return `>= ${range.low}`;
            if (range.high != null) return `<= ${range.high}`;
          }
          if (parameter.normalMin != null && parameter.normalMax != null) return `${parameter.normalMin} - ${parameter.normalMax}`;
          if (parameter.normalMin != null) return `>= ${parameter.normalMin}`;
          if (parameter.normalMax != null) return `<= ${parameter.normalMax}`;
          return '';
        };

        const flagText = (flag: unknown) => flag === 'LOW' ? 'L ↓' : flag === 'HIGH' ? 'H ↑' : '';

        tests.forEach((test: any, testIndex: number) => {
          const department = text(test.test?.department || test.test?.category || 'LABORATORY').toUpperCase();
          const testName = text(test.test?.name || 'Laboratory Test').toUpperCase();
          const sampleType = text(test.test?.sampleType || firstSample.specimenType || '');
          const method = text(test.test?.method || '');
          const parameters = Array.isArray(test.parameters) ? test.parameters : [];

          ensureSpace(34);
          doc.font('Helvetica-Bold').fontSize(8.6).text(department, LEFT, cursorY, { width: RIGHT - LEFT, align: 'center', lineGap: 0 });
          cursorY += 12;
          doc.font('Helvetica-Bold').fontSize(8.6).text(testName, 90, cursorY, { width: 335, align: 'center', lineGap: 0 });
          if (sampleType) doc.font('Helvetica-Bold').fontSize(6.5).text(`Sample Type: ${sampleType}`, 12, cursorY + 1, { width: 130, lineGap: 0 });
          cursorY += 14;

          parameters.forEach((parameter: any, index: number) => {
            const name = text(parameter.name);
            const value = parameter.value == null ? '' : String(parameter.value);
            const ref = rangeText(parameter);
            const unit = text(parameter.unit || '');
            const flag = flagText(parameter.flag);
            const abnormal = parameter.flag === 'LOW' || parameter.flag === 'HIGH';
            const methodLine = index === 0 && method ? `METHOD : ${method.toUpperCase()}` : '';
            const rowHeight = methodLine ? 27 : 16;
            ensureSpace(rowHeight);

            doc.font(abnormal ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.0);
            doc.text(name, index === 0 ? 12 : 31, cursorY, { width: 205, lineGap: 0 });
            doc.text(value, 235, cursorY, { width: 92, lineGap: 0 });
            doc.text(flag, 347, cursorY, { width: 42, align: 'center', lineGap: 0 });
            doc.text(ref, 399, cursorY, { width: 103, lineGap: 0 });
            doc.text(unit, 507, cursorY, { width: 63, lineGap: 0 });
            cursorY += 10;

            if (methodLine) {
              doc.font('Helvetica').fontSize(5.7).text(methodLine, index === 0 ? 12 : 31, cursorY, { width: 235, lineGap: 0 });
              cursorY += 9;
            }
          });

          const interpretation = text(test.test?.interpretation || test.test?.remarks || '');
          if (interpretation) {
            ensureSpace(35);
            doc.font('Helvetica-Bold').fontSize(7.6).text('Interpretation:', LEFT, cursorY + 3, { lineGap: 0 });
            cursorY += 13;
            doc.font('Helvetica').fontSize(6.4).text(interpretation, LEFT, cursorY, { width: RIGHT - LEFT, lineGap: 1 });
            cursorY = doc.y + 5;
          }
          if (testIndex < tests.length - 1) cursorY += 5;
        });

        if (data.order?.clinicalNotes) {
          ensureSpace(32);
          doc.font('Helvetica-Bold').fontSize(7.6).text('Clinical Notes:', LEFT, cursorY, { lineGap: 0 });
          cursorY += 12;
          doc.font('Helvetica').fontSize(6.4).text(text(data.order.clinicalNotes), LEFT, cursorY, { width: RIGHT - LEFT, lineGap: 1 });
        }

        const pages = doc.bufferedPageRange();
        const totalPages = pages.count;
        for (let i = pages.start; i < pages.start + totalPages; i += 1) {
          doc.switchToPage(i);
          drawFooter(i - pages.start + 1, totalPages);
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

private createReportNumber(labCode: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);

  const random = Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase();

  return `${labCode}-R-${timestamp}-${random}`;
}

  private async getOrder(currentUser: AuthUser, orderId: string) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id: orderId, labId: currentUser.labId },
      include: {
        patient: true,
        samples: true,
        items: {
          include: {
            test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } },
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
        tests: order.items.map((item: any) => {
          const resultByParameterId = new Map<string, any>(
            item.results.map((row: any) => [row.parameterId, row]),
          );
          return {
            orderItemId: item.id,
            test: {
              id: item.test.id,
              code: item.test.code,
              name: item.test.name,
              category: item.test.category,
              department: item.test.department,
              sampleType: item.test.sampleType,
              method: item.test.method,
              remarks: item.test.remarks,
            },
            parameters: item.test.parameters.map((parameter: any) => {
              const result = resultByParameterId.get(parameter.id);
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
                remarks: parameter.remarks,
              };
            }),
          };
        }),
      },
      finalizedAt,
    };
  }
}
