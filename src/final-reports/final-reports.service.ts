import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditAction, OrderStatus, SampleStatus } from '@prisma/client';
import { generate } from 'html-pdf-node';
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
      select: { id: true, code: true, name: true, mobile: true, email: true, address: true, icon: true },
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
        where: { id: order.id, labId: currentUser.labId, status: OrderStatus.VERIFIED },
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
      select: { id: true, code: true, name: true, mobile: true, email: true, address: true, icon: true },
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
      return await generate(
        { content: this.toHtml(data) },
        {
          format: 'A4',
          printBackground: true,
          margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
          preferCSSPageSize: true,
        },
      );
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

  private toHtml(data: any): string {
    const e = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
    const date = (value?: Date | string | null) => {
      if (!value) return 'N/A';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return 'N/A';
      return parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    const shortDate = (value?: Date | string | null) => {
      if (!value) return 'N/A';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return 'N/A';
      return parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    const status = String(data.order.status ?? 'FINAL').toUpperCase();
    const statusClass = status === 'FINAL' ? 'status-final' : status === 'VERIFIED' ? 'status-verified' : 'status-pending';
    const flagClass = (flag?: string | null) => flag === 'HIGH' ? 'flag-high' : flag === 'LOW' ? 'flag-low' : flag === 'NORMAL' ? 'flag-normal' : 'flag-neutral';

    const tests = data.order.tests.map((test: any) => {
      const rows = test.parameters.map((parameter: any) => `
        <tr class="${parameter.flag ? flagClass(parameter.flag) : ''}">
          <td class="parameter">${e(parameter.name)}</td>
          <td class="result">${e(parameter.value ?? 'N/A')}</td>
          <td>${e(parameter.unit || '—')}</td>
          <td>${e(this.referenceRange(parameter) || '—')}</td>
          <td><span class="flag ${flagClass(parameter.flag)}">${e(parameter.flag || '—')}</span></td>
        </tr>`).join('');
      return `<section class="test-section">
        <div class="test-heading">
          <div class="test-name">${e(test.test.name)}</div>
          <div class="test-meta">${e(test.test.department || test.test.category || 'Laboratory')}${test.test.code ? ` · Code: ${e(test.test.code)}` : ''}${test.test.sampleType ? ` · Specimen: ${e(test.test.sampleType)}` : ''}${test.test.method ? ` · Method: ${e(test.test.method)}` : ''}</div>
        </div>
        <table class="results-table"><thead><tr><th>INVESTIGATION</th><th>RESULT</th><th>UNIT</th><th>REFERENCE VALUE</th><th>FLAG</th></tr></thead><tbody>${rows}</tbody></table>
      </section>`;
    }).join('');

    const samples = (data.order.samples ?? []).map((sample: any) => `
      <div class="sample-item">
        <span class="sample-accession">${e(sample.accessionNumber)}</span>
        <span>${e(sample.specimenType)}</span>
        <span>${e(sample.container || 'Container not specified')}</span>
        <span>Collected: ${e(shortDate(sample.collectedAt))}</span>
        <span>Received: ${e(shortDate(sample.receivedAt))}</span>
      </div>`).join('');

    const notes = data.order.clinicalNotes ? `<section class="notes-section"><div class="section-label">CLINICAL NOTES</div><div class="notes">${e(data.order.clinicalNotes)}</div></section>` : '';
    const logo = data.lab.icon ? `<img class="lab-logo" src="${e(data.lab.icon)}" alt="Laboratory logo" />` : `<div class="lab-logo-fallback">LAB</div>`;

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
      @page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}body{font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:9.5pt;padding:32mm 13mm 26mm}
      .page-header{position:fixed;top:0;left:0;right:0;height:28mm;padding:5mm 13mm 3mm;background:#fff;border-top:2.5mm solid #0369a1;border-bottom:.35mm solid #cbd5e1}.header-main{display:table;width:100%;table-layout:fixed}.brand{display:table-cell;width:58%;vertical-align:middle}.contact{display:table-cell;width:42%;vertical-align:middle;text-align:right;color:#64748b;font-size:7.2pt;line-height:1.45}.brand-row{display:flex;align-items:center;gap:3mm}.lab-logo{width:15mm;height:15mm;object-fit:contain;border-radius:1.5mm}.lab-logo-fallback{width:15mm;height:15mm;display:grid;place-items:center;border-radius:1.5mm;background:#e0f2fe;color:#0369a1;font-weight:800;font-size:6pt}.lab-name{font-size:17pt;font-weight:800;color:#0f172a;line-height:1.05}.tagline{margin-top:1mm;color:#64748b;font-size:7.2pt}.report-label{color:#0369a1;font-weight:800;font-size:7pt;letter-spacing:.7px;text-transform:uppercase;margin-bottom:1mm}
      .page-footer{position:fixed;bottom:0;left:0;right:0;height:19mm;padding:3mm 13mm;background:#fff;border-top:.35mm solid #cbd5e1;color:#64748b;font-size:6.5pt}.footer-line{display:table;width:100%;table-layout:fixed}.footer-left,.footer-center,.footer-right{display:table-cell;vertical-align:middle}.footer-center{text-align:center}.footer-right{text-align:right}
      .identity{display:table;width:100%;border:.35mm solid #cbd5e1;border-radius:2mm;background:#f8fafc;padding:3.5mm;table-layout:fixed;page-break-inside:avoid}.identity-col{display:table-cell;vertical-align:top;width:33.333%}.identity-col+.identity-col{padding-left:5mm;border-left:.25mm solid #e2e8f0}.field{margin-bottom:2.7mm}.label{display:block;color:#64748b;font-size:6.3pt;font-weight:800;text-transform:uppercase;letter-spacing:.3px;margin-bottom:.7mm}.value{color:#0f172a;font-size:8pt;font-weight:600;word-break:break-word}.status{display:inline-block;padding:1.1mm 2.8mm;border-radius:5mm;font-size:6.8pt;font-weight:800}.status-final{color:#166534;background:#dcfce7}.status-verified{color:#1d4ed8;background:#dbeafe}.status-pending{color:#92400e;background:#fef3c7}
      .section-title{margin:6mm 0 2mm;color:#0369a1;font-size:8.3pt;font-weight:800;letter-spacing:.5px;text-transform:uppercase}.section-subtitle{color:#64748b;font-size:7pt;margin-bottom:2.5mm}.test-section{margin-top:6mm;page-break-inside:auto}.test-heading{border-left:1.2mm solid #0369a1;padding:1.5mm 0 1.5mm 3mm;margin-bottom:2.5mm;page-break-after:avoid}.test-name{font-size:10.8pt;font-weight:800;color:#0f172a}.test-meta{color:#64748b;font-size:6.9pt;margin-top:1mm}
      .results-table{width:100%;border-collapse:collapse;table-layout:fixed;page-break-inside:auto}.results-table thead{display:table-header-group}.results-table tr{page-break-inside:avoid;page-break-after:auto}.results-table th{padding:2.4mm 2mm;background:#0f172a;color:#fff;font-size:6.6pt;text-align:left;letter-spacing:.2px}.results-table th:nth-child(1){width:38%}.results-table th:nth-child(2){width:15%}.results-table th:nth-child(3){width:12%}.results-table th:nth-child(4){width:24%}.results-table th:nth-child(5){width:11%}.results-table td{padding:2.5mm 2mm;border-bottom:.25mm solid #e2e8f0;color:#334155;vertical-align:top;word-break:break-word}.results-table tbody tr:nth-child(even) td{background:#f8fafc}.results-table td.parameter,.results-table td.result{color:#0f172a;font-weight:800}.results-table tr.flag-high td{background:#fff5f5}.results-table tr.flag-low td{background:#fffaf0}.flag{display:inline-block;min-width:14mm;text-align:center;padding:1mm 1.3mm;border-radius:4mm;font-size:6.3pt;font-weight:800}.flag-high{color:#b91c1c;background:#fee2e2}.flag-low{color:#92400e;background:#fef3c7}.flag-normal{color:#166534;background:#dcfce7}.flag-neutral{color:#64748b;background:#f1f5f9}
      .sample-list{border:.3mm solid #cbd5e1;border-radius:2mm;overflow:hidden;page-break-inside:avoid}.sample-item{display:grid;grid-template-columns:18% 16% 17% 25% 24%;padding:2.4mm 3mm;border-bottom:.25mm solid #e2e8f0;color:#475569;font-size:6.7pt;gap:2mm}.sample-item:last-child{border-bottom:0}.sample-accession{color:#0f172a;font-weight:800}
      .notes-section{margin-top:5mm;page-break-inside:avoid}.section-label{color:#0369a1;font-size:8pt;font-weight:800;letter-spacing:.5px}.notes{margin-top:2mm;padding:3mm;border:.3mm solid #cbd5e1;border-radius:2mm;background:#f8fafc;color:#475569;white-space:pre-wrap;line-height:1.45}
      .authorization{margin-top:11mm;display:table;width:100%;table-layout:fixed;page-break-inside:avoid}.authorization-col{display:table-cell;width:50%;vertical-align:bottom}.authorization-col:last-child{text-align:right}.signature-line{width:62mm;border-top:.3mm solid #94a3b8;margin-bottom:2mm}.authorization-col:last-child .signature-line{margin-left:auto}.authorized-name{color:#0f172a;font-weight:800;font-size:8pt}.authorized-role{color:#64748b;font-size:7pt;margin-top:1mm}.end-note{margin-top:5mm;color:#94a3b8;font-size:6.4pt;text-align:center;page-break-inside:avoid}.report-banner{margin:5mm 0 2mm;text-align:center}.report-title{display:inline-block;padding:1.5mm 7mm;border-bottom:.5mm solid #0369a1;color:#0f172a;font-size:11pt;font-weight:800;letter-spacing:.5px}.confidential{margin-top:2mm;text-align:center;color:#94a3b8;font-size:6pt}
    </style></head><body>
      <header class="page-header"><div class="header-main"><div class="brand"><div class="brand-row">${logo}<div><div class="lab-name">${e(data.lab.name || 'Diagnostic Laboratory')}</div><div class="tagline">Laboratory Diagnostic Services</div></div></div></div><div class="contact"><div class="report-label">Pathology Laboratory Report</div><div>${e(data.lab.address || '')}</div><div>${data.lab.mobile ? `Phone: ${e(data.lab.mobile)}` : ''}${data.lab.email ? ` · ${e(data.lab.email)}` : ''}</div><div>Lab Code: ${e(data.lab.code || 'N/A')}</div></div></div></header>
      <footer class="page-footer"><div class="footer-line"><div class="footer-left">Report ${e(data.reportNumber)} · Version ${e(data.version)}</div><div class="footer-center">Computer generated report · Please verify patient identity</div><div class="footer-right">Page <span class="pageNumber"></span></div></div></footer>
      <main>
        <div class="report-banner"><div class="report-title">DIAGNOSTIC LABORATORY REPORT</div></div>
        <div class="identity"><div class="identity-col"><div class="field"><span class="label">Patient Name</span><span class="value">${e(data.order.patient.name)}</span></div><div class="field"><span class="label">Age / Gender</span><span class="value">${e(data.order.patient.age ?? 'N/A')} Yrs / ${e(data.order.patient.gender || 'N/A')}</span></div><div class="field"><span class="label">Mobile</span><span class="value">${e(data.order.patient.mobile || 'N/A')}</span></div></div><div class="identity-col"><div class="field"><span class="label">Report Number</span><span class="value">${e(data.reportNumber)}</span></div><div class="field"><span class="label">Order Number</span><span class="value">${e(data.order.orderNumber)}</span></div><div class="field"><span class="label">Referred By</span><span class="value">${e(data.order.referredBy || 'Self / Walk-in')}</span></div></div><div class="identity-col"><div class="field"><span class="label">Registered</span><span class="value">${e(date(data.order.orderedAt))}</span></div><div class="field"><span class="label">Reported</span><span class="value">${e(date(data.finalizedAt))}</span></div><div class="field"><span class="label">Status</span><span class="status ${statusClass}">${e(status)}</span></div></div></div>
        ${samples ? `<div class="section-title">Specimen Information</div><div class="sample-list">${samples}</div>` : ''}
        <div class="section-title">Laboratory Results</div><div class="section-subtitle">Reference intervals shown are the configured intervals captured with this finalized report.</div>${tests}${notes}
        <div class="authorization"><div class="authorization-col"><div class="signature-line"></div><div class="authorized-name">${e(data.finalizedBy?.username || 'Laboratory Authorized User')}</div><div class="authorized-role">${e(data.finalizedBy?.role || 'Authorized Signatory')} · Finalized ${e(date(data.finalizedAt))}</div></div><div class="authorization-col"><div class="signature-line"></div><div class="authorized-name">Laboratory Quality Review</div><div class="authorized-role">Report generated from the verified laboratory result record</div></div></div>
        <div class="confidential">Patient information is confidential. If this report is received in error, please notify the laboratory.</div><div class="end-note">This report is intended for clinical use. Results should be interpreted by a qualified healthcare professional.</div>
      </main>
    </body></html>`;
  }

  private referenceRange(parameter: any): string {
    const reference = parameter.referenceRange;
    if (reference !== null && reference !== undefined) {
      if (typeof reference === 'string') return reference;
      if (typeof reference === 'object') {
        if (reference.displayRange) return String(reference.displayRange);
        if (reference.low != null && reference.high != null) return `${reference.low} - ${reference.high}`;
        if (reference.low != null) return `>= ${reference.low}`;
        if (reference.high != null) return `<= ${reference.high}`;
        if (reference.text) return String(reference.text);
      }
    }
    if (parameter.normalMin === null && parameter.normalMax === null) return '';
    if (parameter.normalMin !== null && parameter.normalMax !== null) return `${parameter.normalMin} - ${parameter.normalMax}`;
    if (parameter.normalMin !== null) return `>= ${parameter.normalMin}`;
    return `<= ${parameter.normalMax}`;
  }
}
