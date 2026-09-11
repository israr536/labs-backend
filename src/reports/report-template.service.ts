import { Injectable, ServiceUnavailableException } from '@nestjs/common';

// PDFKit is used here instead of html-pdf-node/Puppeteer so report generation works
// reliably in local development and on Render without a Chromium runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

export const REPORT_TEMPLATES = [
  { id: 'classic', name: 'Classic Laboratory', description: 'Traditional diagnostic report with clear clinical sections.' },
  { id: 'modern', name: 'Modern Professional', description: 'Contemporary branded layout with strong visual hierarchy.' },
  { id: 'compact', name: 'Compact Multi-Test', description: 'Dense table-first layout for routine panels.' },
  { id: 'detailed', name: 'Detailed Clinical', description: 'Expanded clinical information and interpretation sections.' },
  { id: 'premium', name: 'Premium Branded', description: 'Premium letterhead-style report for branded laboratories.' },
  { id: 'minimal', name: 'Minimal One-Page', description: 'Simple, clean format for routine single-test reports.' },
] as const;
export type ReportTemplateId = typeof REPORT_TEMPLATES[number]['id'];

type ReportData = any;

@Injectable()
export class ReportTemplateService {
  list() {
    return REPORT_TEMPLATES;
  }

  async generatePdf(data: ReportData, requested?: string): Promise<Buffer> {
    const template = this.normalize(requested);

    try {
      return await this.generatePdfKit(data, template);
    } catch (error) {
      console.error('Report template PDF generation failed', {
        template,
        reportId: data?.report?.id,
        error: error instanceof Error ? error.stack || error.message : error,
      });
      throw new ServiceUnavailableException('PDF generation is temporarily unavailable');
    }
  }

  normalize(value?: string): ReportTemplateId {
    return REPORT_TEMPLATES.some((item) => item.id === value)
      ? value as ReportTemplateId
      : 'classic';
  }

  private generatePdfKit(data: ReportData, template: ReportTemplateId): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 36, right: 36, bottom: 42, left: 36 },
        bufferPages: true,
        info: {
          Title: `${data?.test?.name || 'Laboratory Report'} - ${data?.report?.reportNumber || ''}`,
          Author: data?.lab?.name || 'Laboratory',
          Subject: 'Diagnostic Laboratory Report',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        this.renderDocument(doc, data, template);
        this.addPageNumbers(doc, data, template);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private renderDocument(doc: any, data: ReportData, template: ReportTemplateId) {
    const accent = this.accent(template);
    const lab = data?.lab || {};
    const patient = data?.patient || {};
    const report = data?.report || {};
    const test = data?.test || {};
    const results = Array.isArray(data?.results) ? data.results : [];
    const reportNumber = String(report.reportNumber || report.id || 'REPORT');

    this.renderHeader(doc, lab, reportNumber, template, accent);
    this.renderPatientSection(doc, patient, report, template, accent);
    this.renderTestHeading(doc, test, template, accent);
    this.renderResultsTable(doc, results, template, accent);

    if (report.remarks || report.doctorNotes) {
      this.renderNotes(doc, report, template, accent);
    }

    this.renderSignatures(doc, template, accent);
    this.renderFooter(doc, lab, reportNumber, template);
  }

  private renderHeader(doc: any, lab: any, reportNumber: string, template: ReportTemplateId, accent: string) {
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const top = doc.y;
    const nameSize = 9;

    doc.font('Helvetica-Bold').fontSize(nameSize).fillColor('#111111').text(this.text(lab.name, 'Laboratory'), 300, top, { width: width, align: 'right' });
    doc.font('Helvetica').fontSize(6).fillColor('#333333');
    if (lab.address) doc.text(this.text(lab.address), 300, top + 11, { width: width, align: 'right' });
    const contact = [lab.mobile, lab.email].filter(Boolean).join(' · ');
    if (contact) doc.text(contact, 300, top + 22, { width: width, align: 'right' });

    const barcodeWidth = 116;
    const barcodeX = doc.page.width - doc.page.margins.right - barcodeWidth;
    const barcodeY = top + 30;
    this.drawCode39(doc, reportNumber, barcodeX, barcodeY, barcodeWidth, 32);

    const lineY = 78;
    doc.moveTo(doc.page.margins.left, lineY).lineTo(doc.page.width - doc.page.margins.right, lineY)
      .lineWidth(0.8).strokeColor('#111111').stroke();
    doc.y = lineY + 10;
  }

  private renderPatientSection(doc: any, patient: any, report: any, template: ReportTemplateId, accent: string) {
    const fields = [
      ['Patient', patient.name || 'N/A'],
      ['Age / Gender', `${patient.age ?? 'N/A'} / ${patient.gender || 'N/A'}`],
      ['Report No.', report.reportNumber || report.id || 'N/A'],
      ['Mobile', patient.mobile || 'N/A'],
      ['Referred By', report.referredBy || 'N/A'],
      ['Collected', this.date(report.sampleCollectedAt)],
      ['Reported', this.date(report.reportedAt)],
      ['Status', report.status || 'N/A'],
    ];

    const boxY = doc.y;
    const boxHeight = 82;
    doc.rect(doc.page.margins.left, boxY, doc.page.width - doc.page.margins.left - doc.page.margins.right, boxHeight)
      .fillAndStroke('#ffffff', '#111111');

    const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 4;
    fields.forEach(([label, value], index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      const x = doc.page.margins.left + col * colWidth + 8;
      const y = boxY + 8 + row * 31;
      doc.font('Helvetica').fontSize(6.5).fillColor('#222222').text(label, x, y, { width: colWidth - 12 });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#111111').text(this.text(value), x + 58, y, { width: colWidth - 70, ellipsis: true });
    });

    doc.y = boxY + boxHeight + 11;
  }

  private renderTestHeading(doc: any, test: any, template: ReportTemplateId, accent: string) {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111111')
      .text(this.text(test.name, 'Laboratory Test').toUpperCase(), doc.page.margins.left, y + 4, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' });
    if (test.category) {
      doc.font('Helvetica').fontSize(7).fillColor('#333333').text(this.text(test.category), doc.page.margins.left, y + 15, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' });
    }
    doc.y = y + (test.category ? 28 : 22);
  }

  private renderResultsTable(doc: any, results: any[], template: ReportTemplateId, accent: string) {
    const x = doc.page.margins.left;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columns = [
      { label: 'Parameter', width: tableWidth * 0.29 },
      { label: 'Result', width: tableWidth * 0.17 },
      { label: 'Unit', width: tableWidth * 0.14 },
      { label: 'Reference Range', width: tableWidth * 0.25 },
      { label: 'Flag', width: tableWidth * 0.15 },
    ];
    const rowHeight = template === 'compact' ? 19 : 22;
    const headerHeight = 24;
    let y = doc.y;

    const drawHeader = () => {
      doc.moveTo(x, y + headerHeight).lineTo(x + tableWidth, y + headerHeight).lineWidth(0.8).strokeColor('#111111').stroke();
      let cx = x;
      columns.forEach((column) => {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#111111').text(column.label === 'Parameter' ? 'TEST DESCRIPTION' : column.label === 'Result' ? 'RESULT ENTRY' : column.label === 'Reference Range' ? 'BIO. REF. RANGE' : column.label.toUpperCase(), cx + 5, y + 8, { width: column.width - 10, align: column.label === 'Flag' ? 'center' : 'left' });
        cx += column.width;
      });
      y += headerHeight;
    };

    drawHeader();
    results.forEach((result: any, index: number) => {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 92) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
      }

      if (index % 2 === 1) doc.rect(x, y, tableWidth, rowHeight).fill('#ffffff');
      doc.moveTo(x, y + rowHeight).lineTo(x + tableWidth, y + rowHeight).lineWidth(0.35).strokeColor('#dbe3ec').stroke();

      const flag = String(result.flag || '').toUpperCase();
      const resultColor = flag === 'HIGH' ? '#a00000' : flag === 'LOW' ? '#a00000' : '#111111';
      const values = [
        this.text(result.name, 'N/A'),
        this.text(result.value, 'N/A'),
        this.text(result.unit),
        this.text(result.normalRange),
        this.text(flag),
      ];
      let cx = x;
      values.forEach((value, columnIndex) => {
        doc.font(columnIndex === 1 || columnIndex === 4 ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(template === 'compact' ? 7 : 7.8)
          .fillColor(columnIndex === 1 ? resultColor : columnIndex === 4 ? resultColor : '#172033')
          .text(value, cx + 5, y + 7, { width: columns[columnIndex].width - 10, align: columnIndex === 4 ? 'center' : 'left', ellipsis: true });
        cx += columns[columnIndex].width;
      });
      y += rowHeight;
    });
    doc.y = y + 8;
  }

  private renderNotes(doc: any, report: any, template: ReportTemplateId, accent: string) {
    if (doc.y + 60 > doc.page.height - doc.page.margins.bottom - 55) doc.addPage();
    const x = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const y = doc.y;
    const noteText = [
      report.remarks ? `Remarks: ${report.remarks}` : '',
      report.doctorNotes ? `Doctor Notes: ${report.doctorNotes}` : '',
    ].filter(Boolean).join('\n');
    const height = Math.max(44, doc.heightOfString(noteText, { width: width - 24 }) + 26);
    doc.roundedRect(x, y, width, height, template === 'minimal' ? 0 : 4).fill('#f8fafc');
    doc.rect(x, y, 3, height).fill(accent);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(accent).text('Clinical Notes / Interpretation', x + 12, y + 8);
    doc.font('Helvetica').fontSize(7.5).fillColor('#172033').text(noteText, x + 12, y + 22, { width: width - 24 });
    doc.y = y + height + 9;
  }

  private renderSignatures(doc: any, template: ReportTemplateId, accent: string) {
    const y = Math.min(doc.y + (template === 'detailed' ? 20 : 12), doc.page.height - 78);
    const left = doc.page.margins.left + 20;
    const right = doc.page.width - doc.page.margins.right - 170;
    doc.moveTo(left, y + 30).lineTo(left + 145, y + 30).lineWidth(0.6).strokeColor('#94a3b8').stroke();
    doc.moveTo(right, y + 30).lineTo(right + 145, y + 30).lineWidth(0.6).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('Authorized Signatory', left, y + 34, { width: 145, align: 'center' });
    doc.text('Pathologist / Consultant', right, y + 34, { width: 145, align: 'center' });
    doc.y = y + 49;
  }

  private renderFooter(doc: any, lab: any, reportNumber: string, template: ReportTemplateId) {
    const footerY = doc.page.height - 38;
    doc.moveTo(doc.page.margins.left, footerY - 7).lineTo(doc.page.width - doc.page.margins.right, footerY - 7).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    doc.font('Helvetica').fontSize(6.5).fillColor('#94a3b8')
      .text(`Report ${this.text(reportNumber)} · Generated ${this.date(new Date())} · ${this.text(lab.name)}`, doc.page.margins.left, footerY, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
      });
  }

  private addPageNumbers(doc: any, data: ReportData, template: ReportTemplateId) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 27;
      doc.font('Helvetica').fontSize(6).fillColor('#94a3b8').text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.margins.left, footerY, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'right',
      });
    }
  }

  /**
   * Draws a scanner-compatible Code 39 barcode. Code 39 uses a narrow/wide
   * pattern with an inter-character narrow white gap and start/stop '*' chars.
   */
  private drawCode39(doc: any, raw: string, x: number, y: number, targetWidth: number, height: number) {
    const value = String(raw || 'REPORT').toUpperCase().replace(/[^0-9A-Z. $/+%-]/g, '-').slice(0, 24);
    const encoded = `*${value}*`;
    const narrow = 1;
    const wide = 3;
    const gap = 1;
    const quiet = 8;
    const modules: Array<{ black: boolean; units: number }> = [];

    for (const character of encoded) {
      const pattern = CODE39[character] || CODE39['-'];
      for (let i = 0; i < pattern.length; i++) {
        modules.push({ black: i % 2 === 0, units: pattern[i] === '1' ? wide : narrow });
      }
      modules.push({ black: false, units: gap });
    }

    const totalUnits = modules.reduce((sum, item) => sum + item.units, 0);
    const scale = Math.min(2.1, (targetWidth - quiet * 2) / totalUnits);
    let cursor = x + quiet;
    modules.forEach((module) => {
      const width = module.units * scale;
      if (module.black) doc.rect(cursor, y, width, height).fill('#111111');
      cursor += width;
    });

    doc.font('Helvetica').fontSize(5.5).fillColor('#111111').text(value, x, y + height + 2, { width: targetWidth, align: 'center' });
  }

  private accent(template: ReportTemplateId) {
    if (template === 'premium') return '#7c3aed';
    if (template === 'modern') return '#0f766e';
    if (template === 'minimal') return '#334155';
    return '#075985';
  }

  private date(value: unknown) {
    if (!value) return 'N/A';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString('en-IN');
  }

  private text(value: unknown, fallback = '') {
    const result = String(value ?? '').trim();
    return result || fallback;
  }
}

const CODE39: Record<string, string> = {
  '0':'101001101101','1':'110100101011','2':'101100101011','3':'110110010101','4':'101001101011','5':'110100110101','6':'101100110101','7':'101001011011','8':'110100101101','9':'101100101101','A':'110101001011','B':'101101001011','C':'110110100101','D':'101011001011','E':'110101100101','F':'101101100101','G':'101010011011','H':'110101001101','I':'101101001101','J':'101011001101','K':'110101010011','L':'101101010011','M':'110110101001','N':'101011010011','O':'110101101001','P':'101101101001','Q':'101010110011','R':'110101011001','S':'101101011001','T':'101011011001','U':'110010101011','V':'100110101011','W':'110011010101','X':'100101101011','Y':'110010110101','Z':'100110110101','-':'100101011011','.':'110010101101',' ':'100110101101','$':'100100100101','/':'100100101001','+':'100101001001','%':'101001001001','*':'100101101101'
};
