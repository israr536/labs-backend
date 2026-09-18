import { Injectable, ServiceUnavailableException } from '@nestjs/common';

// PDFKit avoids the Chromium/Puppeteer runtime dependency for server-side report PDFs.
const PDFDocument = require('pdfkit');

interface ReportData {
  report: {
    id: string;
    reportNumber: string;
    status: string;
    remarks?: string | null;
    doctorNotes?: string | null;
    referredBy?: string | null;
    sampleCollectedAt?: Date | null;
    reportedAt?: Date | null;
    createdAt: Date;
  };
  lab: {
    name: string;
    code: string;
    mobile: string;
    email?: string | null;
    address?: string | null;
  };
  patient: {
    id?: string;
    name: string;
    age?: number | null;
    gender?: string | null;
    mobile?: string | null;
    email?: string | null;
    dateOfBirth?: Date | null;
  };
  test: { id: string; name: string; category?: string | null };
  results: Array<{
    name: string;
    value: string | null;
    unit?: string | null;
    normalRange?: string | null;
    flag?: string | null;
  }>;
}

@Injectable()
export class PdfService {
  async generateReportPdf(data: ReportData): Promise<Buffer> {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 42 });
      const chunks: Buffer[] = [];

      return await new Promise<Buffer>((resolve, reject) => {
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.renderPdf(doc, data);
        doc.end();
      });
    } catch {
      throw new ServiceUnavailableException('PDF generation is temporarily unavailable');
    }
  }

  private renderPdf(doc: any, data: ReportData): void {
    const e = (value: unknown) => String(value ?? '');
    const date = (value?: Date | null) =>
      value ? new Date(value).toLocaleString('en-IN') : 'N/A';

    doc.font('Helvetica-Bold').fontSize(20).text(e(data.lab.name), { align: 'center' });
    doc.font('Helvetica').fontSize(9).text(e(data.lab.address || ''), { align: 'center' });
    doc.text(`${e(data.lab.mobile)}${data.lab.email ? ` | ${e(data.lab.email)}` : ''}`, {
      align: 'center',
    });
    doc.moveDown(1);
    doc.moveTo(42, doc.y).lineTo(553, doc.y).stroke();
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(12).text('Patient Information');
    doc.font('Helvetica').fontSize(9);
    doc.text(`Name: ${e(data.patient.name)}`);
    doc.text(`Age / Gender: ${e(data.patient.age ?? 'N/A')} / ${e(data.patient.gender)}`);
    doc.text(`Mobile: ${e(data.patient.mobile || 'N/A')}`);
    doc.text(`Report No: ${e(data.report.reportNumber)}`);
    doc.text(`Referred By: ${e(data.report.referredBy || 'N/A')}`);
    doc.text(`Collected: ${date(data.report.sampleCollectedAt)}`);
    doc.text(`Reported: ${date(data.report.reportedAt)}`);
    doc.text(`Status: ${e(data.report.status)}`);
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(12).text(`Test: ${e(data.test.name)}`);
    doc.font('Helvetica').fontSize(9).text(`Category: ${e(data.test.category || 'N/A')}`);
    doc.moveDown(0.5);

    const columns = [
      { label: 'Parameter', width: 150 },
      { label: 'Result', width: 90 },
      { label: 'Unit', width: 80 },
      { label: 'Reference Range', width: 120 },
      { label: 'Flag', width: 63 },
    ];
    let y = doc.y;
    const rowHeight = 24;

    doc.font('Helvetica-Bold').fontSize(8);
    let x = 42;
    for (const column of columns) {
      doc.rect(x, y, column.width, rowHeight).fill('#e9eef5');
      doc.fillColor('#172033').text(column.label, x + 4, y + 7, {
        width: column.width - 8,
        align: column.label === 'Flag' ? 'center' : 'left',
      });
      x += column.width;
    }
    y += rowHeight;

    for (const result of data.results) {
      if (y > 730) {
        doc.addPage();
        y = 42;
      }
      const values = [
        e(result.name),
        e(result.value || 'N/A'),
        e(result.unit || ''),
        e(result.normalRange || ''),
        e(result.flag || ''),
      ];
      x = 42;
      doc.font('Helvetica').fontSize(8).fillColor('#172033');
      values.forEach((value, index) => {
        doc.rect(x, y, columns[index].width, rowHeight).stroke('#cbd5e1');
        doc.text(value, x + 4, y + 7, {
          width: columns[index].width - 8,
          align: index === 4 ? 'center' : 'left',
          ellipsis: true,
        });
        x += columns[index].width;
      });
      y += rowHeight;
    }

    doc.y = y + 15;
    if (data.report.remarks || data.report.doctorNotes) {
      doc.font('Helvetica-Bold').fontSize(11).text('Additional Information');
      doc.font('Helvetica').fontSize(9);
      if (data.report.remarks) doc.text(`Remarks: ${e(data.report.remarks)}`);
      if (data.report.doctorNotes) doc.text(`Doctor Notes: ${e(data.report.doctorNotes)}`);
      doc.moveDown(1);
    }

    doc.font('Helvetica').fontSize(7).fillColor('#64748b');
    doc.text(
      `Report ${e(data.report.reportNumber)} | Generated by the laboratory reporting system | ${date(new Date())}`,
      42,
      790,
      { width: 511, align: 'center' },
    );
  }

  generateReportHtml(data: ReportData): string {
    const e = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
    );
    const rows = data.results
      .map(
        (result) =>
          `<tr><td>${e(result.name)}</td><td>${e(result.value || 'N/A')}</td><td>${e(result.unit || '')}</td><td>${e(result.normalRange || '')}</td><td>${e(result.flag || '')}</td></tr>`,
      )
      .join('');
    return `<!doctype html><html><body><h1>${e(data.lab.name)}</h1><p>${e(data.patient.name)}</p><p>${e(data.report.reportNumber)}</p><table>${rows}</table></body></html>`;
  }
}
