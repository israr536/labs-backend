import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { generate } from 'html-pdf-node';

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
  list() { return REPORT_TEMPLATES; }
  async generatePdf(data: ReportData, requested?: string): Promise<Buffer> {
    const template = this.normalize(requested);
    try {
      return await generate(
        { content: this.generateHtml(data, template) },
        {
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
          margin: { top: '8mm', right: '10mm', bottom: '12mm', left: '10mm' },
        },
      );
    } catch (error) {
      console.error('Report template PDF generation failed', {
        template,
        reportId: data?.report?.id,
        error: error instanceof Error ? error.stack || error.message : error,
      });
      throw new ServiceUnavailableException('PDF generation is temporarily unavailable');
    }
  }
  normalize(value?: string): ReportTemplateId { return REPORT_TEMPLATES.some((item) => item.id === value) ? value as ReportTemplateId : 'classic'; }

  private generateHtml(data: ReportData, template: ReportTemplateId): string {
    const e = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] ?? c));
    const date = (v: unknown) => v ? new Date(String(v)).toLocaleString('en-IN') : '—';
    const reportNo = e(data.report.reportNumber);
    const barcode = code39Svg(data.report.reportNumber || data.report.id);
    const p = data.patient; const lab = data.lab;
    const rows = (data.results ?? []).map((r: any, i: number) => { const flag = e(r.flag || ''); const cls = r.flag === 'HIGH' ? 'high' : r.flag === 'LOW' ? 'low' : 'normal'; return `<tr class="${i % 2 ? 'alt' : ''}"><td>${e(r.name)}</td><td class="result ${cls}">${e(r.value || 'N/A')}</td><td>${e(r.unit || '')}</td><td>${e(r.normalRange || '')}</td><td class="flag ${cls}">${flag}</td></tr>`; }).join('');
    const notes = data.report.remarks || data.report.doctorNotes ? `<section class="notes"><h3>Clinical Notes / Interpretation</h3>${data.report.remarks ? `<p><b>Remarks:</b> ${e(data.report.remarks)}</p>` : ''}${data.report.doctorNotes ? `<p><b>Doctor Notes:</b> ${e(data.report.doctorNotes)}</p>` : ''}</section>` : '';
    const header = `<header class="header"><div><div class="lab-name">${e(lab.name)}</div><div class="muted">${e(lab.address || '')}</div><div class="muted">${e(lab.mobile)}${lab.email ? ` · ${e(lab.email)}` : ''}</div></div><div class="barcode">${barcode}<small>${reportNo}</small></div></header>`;
    const patient = `<section class="patient"><div><b>Patient</b><span>${e(p.name)}</span></div><div><b>Age / Gender</b><span>${e(p.age ?? 'N/A')} / ${e(p.gender)}</span></div><div><b>Report No.</b><span>${reportNo}</span></div><div><b>Mobile</b><span>${e(p.mobile || 'N/A')}</span></div><div><b>Referred By</b><span>${e(data.report.referredBy || 'N/A')}</span></div><div><b>Collected</b><span>${e(date(data.report.sampleCollectedAt))}</span></div><div><b>Reported</b><span>${e(date(data.report.reportedAt))}</span></div><div><b>Status</b><span>${e(data.report.status)}</span></div></section>`;
    const table = `<section><div class="test-title"><span>Laboratory Test</span><strong>${e(data.test.name)}</strong><small>${e(data.test.category || '')}</small></div><table><thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference Range</th><th>Flag</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    const signatures = `<footer class="signatures"><div><span></span>Authorized Signatory</div><div><span></span>Pathologist / Consultant</div></footer><div class="footer">Report ${reportNo} · Generated ${e(date(new Date()))} · ${e(lab.name)}</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>${this.css(template)}</style></head><body class="${template}">${header}${patient}${table}${notes}${signatures}</body></html>`;
  }

  private css(t: ReportTemplateId) {
    const accent = t === 'premium' ? '#7c3aed' : t === 'modern' ? '#0f766e' : t === 'minimal' ? '#334155' : '#075985';
    const tableHeader = t === 'compact' ? '#0f172a' : accent;
    return `@page{size:A4;margin:0}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:10px;margin:0;padding:10mm;line-height:1.35}.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${accent};padding:0 0 8px;margin-bottom:8px}.lab-name{font-size:${t==='premium'?'23':'20'}px;font-weight:800;color:${accent};margin-bottom:3px}.muted{color:#64748b;font-size:9px}.barcode{text-align:right}.barcode svg{width:125px;height:42px;display:block}.barcode small{font-size:7px;letter-spacing:1px}.patient{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:8px;background:${t==='premium'?'#faf5ff':t==='modern'?'#f0fdfa':'#f8fafc'};border:1px solid #dbe3ec;border-radius:${t==='minimal'?'0':'5'}px;margin-bottom:9px}.patient div{display:flex;flex-direction:column;gap:2px}.patient b{font-size:7px;text-transform:uppercase;color:#64748b}.patient span{font-size:9px;font-weight:600}.test-title{display:grid;grid-template-columns:95px 1fr auto;align-items:end;gap:6px;border-left:3px solid ${accent};padding:4px 6px;margin-bottom:5px}.test-title span,.test-title small{font-size:7px;color:#64748b;text-transform:uppercase}.test-title strong{font-size:${t==='detailed'?'14':'12'}px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:4px}thead{display:table-header-group}tr{page-break-inside:avoid}.${t} th{background:${tableHeader};color:#fff;font-size:7px;text-align:left;padding:5px}.${t} td{border-bottom:1px solid #e2e8f0;padding:5px;font-size:${t==='compact'?'8':'9'}px}.${t} tr.alt td{background:#f8fafc}.result{font-weight:700}.high{color:#b91c1c}.low{color:#b45309}.normal{color:#166534}.flag{font-weight:700}.notes{margin-top:10px;padding:8px;border-left:3px solid ${accent};background:#f8fafc;page-break-inside:avoid}.notes h3{margin:0 0 4px;color:${accent};font-size:9px}.notes p{margin:2px 0}.signatures{display:flex;justify-content:space-between;gap:30px;margin-top:${t==='detailed'?'22':'16'}px;page-break-inside:avoid}.signatures div{width:42%;text-align:center;font-size:8px;color:#64748b}.signatures span{display:block;border-top:1px solid #94a3b8;margin-bottom:4px}.footer{margin-top:10px;border-top:1px solid #e2e8f0;padding-top:5px;text-align:center;color:#94a3b8;font-size:7px}.modern .patient{border-radius:10px}.premium .header{border-bottom-width:3px}.premium .test-title{background:#faf5ff}.compact .patient{padding:6px;gap:3px}.compact .signatures{margin-top:10px}.detailed .patient{grid-template-columns:repeat(4,1fr);padding:10px}.detailed .notes{min-height:35px}.minimal .header{border-bottom:1px solid #cbd5e1}.minimal .patient{background:#fff;border-radius:0;grid-template-columns:repeat(4,1fr)}.minimal .test-title{border-left:0;border-bottom:1px solid #cbd5e1;padding-left:0}.minimal th{background:#334155}`;
  }
}

const CODE39: Record<string,string> = {
  '0':'101001101101','1':'110100101011','2':'101100101011','3':'110110010101','4':'101001101011','5':'110100110101','6':'101100110101','7':'101001011011','8':'110100101101','9':'101100101101','A':'110101001011','B':'101101001011','C':'110110100101','D':'101011001011','E':'110101100101','F':'101101100101','G':'101010011011','H':'110101001101','I':'101101001101','J':'101011001101','K':'110101010011','L':'101101010011','M':'110110101001','N':'101011010011','O':'110101101001','P':'101101101001','Q':'101010110011','R':'110101011001','S':'101101011001','T':'101011011001','U':'110010101011','V':'100110101011','W':'110011010101','X':'100101101011','Y':'110010110101','Z':'100110110101','-':'100101011011','.':'110010101101',' ':'100110101101','$':'100100100101','/':'100100101001','+':'100101001001','%':'101001001001','*':'100101101101'
};
function code39Svg(raw: string): string { const value = String(raw || 'REPORT').toUpperCase().replace(/[^0-9A-Z. $/+%-]/g, '-').slice(0,32); const encoded=`*${value}*`; let x=0; const bars:string[]=[]; const unit=1.5; for(const ch of encoded){const pattern=CODE39[ch]||CODE39['-']; for(let i=0;i<pattern.length;i++) if(pattern[i]==='1') bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${unit.toFixed(2)}" height="30"/>`); x+=unit;} const width=x+8; return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 38" preserveAspectRatio="none"><g fill="#111">${bars.join('')}</g><text x="${width/2}" y="37" text-anchor="middle" font-family="Arial" font-size="5">${escapeXml(value)}</text></svg>`; }
function escapeXml(value:string){return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));}
