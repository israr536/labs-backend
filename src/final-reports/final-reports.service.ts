import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { OrderStatus, SampleStatus } from '@prisma/client';
import { generate } from 'html-pdf-node';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FinalReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async finalize(currentUser: AuthUser, orderId: string) {
    const order = await this.getOrder(currentUser, orderId);
    if (order.status === OrderStatus.FINAL) return this.getReport(currentUser, orderId);
    if (order.status !== OrderStatus.VERIFIED) throw new BadRequestException('Only verified orders can be finalized');
    if (!order.items.length) throw new BadRequestException('Order has no tests');
    if (!order.samples.length) throw new BadRequestException('Order has no samples');

    const missing: string[] = [];
    for (const item of order.items) {
      for (const parameter of item.test.parameters) {
        const result = item.results.find((row) => row.parameterId === parameter.id);
        if (parameter.isRequired && (!result || !result.value.trim())) missing.push(`${item.test.name}: ${parameter.name}`);
      }
    }
    if (missing.length) throw new BadRequestException(`Missing required results: ${missing.join(', ')}`);
    const incompleteSamples = order.samples.filter((sample) => sample.status !== SampleStatus.COMPLETED);
    if (incompleteSamples.length) throw new BadRequestException(`All samples must be completed before finalization: ${incompleteSamples.map((s) => s.accessionNumber).join(', ')}`);

    const lab = await this.prisma.lab.findUnique({ where: { id: currentUser.labId }, select: { code: true } });
    if (!lab) throw new NotFoundException('Lab not found');
    const reportNumber = await this.createReportNumber(lab.code);

    await this.prisma.$transaction(async (tx) => {
      await tx.finalReport.upsert({
        where: { orderId: order.id },
        create: { labId: currentUser.labId, orderId: order.id, reportNumber, finalizedById: currentUser.id },
        update: {},
      });
      await tx.labOrder.updateMany({ where: { id: order.id, labId: currentUser.labId, status: OrderStatus.VERIFIED }, data: { status: OrderStatus.FINAL } });
    });
    return this.getReport(currentUser, orderId);
  }

  async getReport(currentUser: AuthUser, orderId: string) {
    const report = await this.prisma.finalReport.findFirst({
      where: { orderId, labId: currentUser.labId },
      include: {
        lab: { select: { id: true, code: true, name: true, mobile: true, email: true, address: true } },
        finalizedBy: { select: { id: true, username: true, role: true } },
        order: {
          include: {
            patient: true,
            samples: true,
            items: { include: { test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } }, results: true } },
          },
        },
      },
    });
    if (!report) throw new NotFoundException('Final report not found');
    return this.toView(report);
  }

  async generatePdf(currentUser: AuthUser, orderId: string): Promise<Buffer> {
    const data = await this.getReport(currentUser, orderId);
    if (data.order.status !== OrderStatus.FINAL) throw new BadRequestException('Only final reports can be downloaded as PDF');
    try {
      return await generate({ content: this.toHtml(data) }, { format: 'A4', printBackground: true, margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' } });
    } catch {
      throw new ServiceUnavailableException('PDF generation is temporarily unavailable');
    }
  }

  private async createReportNumber(labCode: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
      const random = Math.random().toString(36).slice(2, 8).toUpperCase();
      const reportNumber = `${labCode}-R-${timestamp}-${random}`;
      const exists = await this.prisma.finalReport.findUnique({ where: { reportNumber }, select: { id: true } });
      if (!exists) return reportNumber;
    }
    throw new BadRequestException('Unable to allocate a unique report number');
  }

  private async getOrder(currentUser: AuthUser, orderId: string) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id: orderId, labId: currentUser.labId },
      include: { patient: true, samples: true, items: { include: { test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } }, results: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private toView(report: any) {
    return {
      id: report.id,
      reportNumber: report.reportNumber,
      finalizedAt: report.finalizedAt,
      finalizedBy: report.finalizedBy,
      lab: report.lab,
      order: {
        id: report.order.id,
        orderNumber: report.order.orderNumber,
        status: report.order.status,
        referredBy: report.order.referredBy,
        clinicalNotes: report.order.clinicalNotes,
        orderedAt: report.order.orderedAt,
        patient: report.order.patient,
        samples: report.order.samples,
        tests: report.order.items.map((item: any) => ({
          orderItemId: item.id,
          test: { id: item.test.id, code: item.test.code, name: item.test.name, category: item.test.category, department: item.test.department, sampleType: item.test.sampleType, method: item.test.method },
          parameters: item.test.parameters.map((parameter: any) => {
            const result = item.results.find((row: any) => row.parameterId === parameter.id);
            return { parameterId: parameter.id, name: parameter.name, value: result?.value ?? null, unit: parameter.unit, referenceRange: parameter.referenceRange, normalMin: parameter.normalMin, normalMax: parameter.normalMax, flag: result?.flag ?? null, displayOrder: parameter.displayOrder };
          }),
        })),
      },
    };
  }

  private toHtml(data: any): string {
    const e = (value: unknown) => String(value ?? '').replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[char] ?? char);
    const date = (value?: Date | string | null) => value ? new Date(value).toLocaleString('en-IN') : 'N/A';
    const flagStyle = (flag?: string | null) => flag === 'HIGH' ? 'color:#b91c1c;font-weight:700' : flag === 'LOW' ? 'color:#92400e;font-weight:700' : flag === 'NORMAL' ? 'color:#166534;font-weight:700' : '';
    const tests = data.order.tests.map((test: any) => {
      const rows = test.parameters.map((p: any) => `<tr><td>${e(p.name)}</td><td>${e(p.value ?? 'N/A')}</td><td>${e(p.unit || '')}</td><td>${e(this.referenceRange(p))}</td><td style="${flagStyle(p.flag)}">${e(p.flag || '')}</td></tr>`).join('');
      return `<div class="test"><h2>${e(test.test.name)}</h2><div class="muted">${e(test.test.department || test.test.category || '')}${test.test.method ? ` | Method: ${e(test.test.method)}` : ''}</div><table><thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference Range</th><th>Flag</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>@page{size:A4;margin:0}body{font-family:Arial,sans-serif;color:#172033;font-size:11px;margin:0;padding:0}h1{margin:0;font-size:24px}h2{font-size:14px;border-bottom:1px solid #bbb;padding-bottom:5px;margin:18px 0 5px}.header{text-align:center;border-bottom:2px solid #222;padding-bottom:12px}.muted{color:#5b6575;font-size:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 20px}.item{padding:3px 0}.label{font-weight:700}table{width:100%;border-collapse:collapse;margin-top:8px}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #ccc;padding:6px;text-align:left}th{background:#f1f3f5;font-size:10px}.test{page-break-inside:auto}.footer{margin-top:25px;border-top:1px solid #ccc;padding-top:10px;text-align:center;font-size:9px;color:#687386}.approval{margin-top:24px;text-align:right}</style></head><body><div class="header"><h1>${e(data.lab.name)}</h1><div class="muted">${e(data.lab.address || '')}</div><div class="muted">${e(data.lab.mobile)}${data.lab.email ? ` | ${e(data.lab.email)}` : ''}</div></div><h2>Patient Information</h2><div class="grid"><div class="item"><span class="label">Name:</span> ${e(data.order.patient.name)}</div><div class="item"><span class="label">Report No:</span> ${e(data.reportNumber)}</div><div class="item"><span class="label">Age / Gender:</span> ${e(data.order.patient.age ?? 'N/A')} / ${e(data.order.patient.gender)}</div><div class="item"><span class="label">Mobile:</span> ${e(data.order.patient.mobile || 'N/A')}</div><div class="item"><span class="label">Order No:</span> ${e(data.order.orderNumber)}</div><div class="item"><span class="label">Ordered:</span> ${e(date(data.order.orderedAt))}</div><div class="item"><span class="label">Finalized:</span> ${e(date(data.finalizedAt))}</div><div class="item"><span class="label">Referred By:</span> ${e(data.order.referredBy || 'N/A')}</div></div>${tests}<div class="approval"><b>Verified / Finalized by:</b> ${e(data.finalizedBy.username)} (${e(data.finalizedBy.role)})<br>${e(date(data.finalizedAt))}</div><div class="footer">Report ${e(data.reportNumber)} | Generated by the laboratory reporting system</div></body></html>`;
  }

  private referenceRange(parameter: any): string {
    if (parameter.referenceRange !== null && parameter.referenceRange !== undefined) return typeof parameter.referenceRange === 'string' ? parameter.referenceRange : JSON.stringify(parameter.referenceRange);
    if (parameter.normalMin === null && parameter.normalMax === null) return '';
    if (parameter.normalMin !== null && parameter.normalMax !== null) return `${parameter.normalMin} - ${parameter.normalMax}`;
    if (parameter.normalMin !== null) return `>= ${parameter.normalMin}`;
    return `<= ${parameter.normalMax}`;
  }
}
