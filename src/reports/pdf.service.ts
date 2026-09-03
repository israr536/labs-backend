import { Injectable } from '@nestjs/common';

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
    name: string;
    age?: number | null;
    gender: string;
    mobile?: string | null;
    email?: string | null;
    dateOfBirth?: Date | null;
  };
  test: {
    id: string;
    name: string;
    category?: string | null;
  };
  results: Array<{
    name: string;
    value: string | null;
    unit?: string | null;
    normalMin?: number | null;
    normalMax?: number | null;
    normalRange?: string | null;
    flag?: string | null;
  }>;
}

@Injectable()
export class PdfService {
  generateReportHtml(data: ReportData): string {
    const flagStyle = (flag?: string | null) => {
      if (flag === 'HIGH') return 'color: #d32f2f; font-weight: bold;';
      if (flag === 'LOW') return 'color: #1976d2; font-weight: bold;';
      if (flag === 'NORMAL') return 'color: #388e3c; font-weight: bold;';
      return '';
    };

    const resultsRows = data.results
      .map(
        (result) => `
      <tr>
        <td style="border: 1px solid #ddd; padding: 8px;">${result.name}</td>
        <td style="border: 1px solid #ddd; padding: 8px;">${result.value || 'N/A'}</td>
        <td style="border: 1px solid #ddd; padding: 8px;">${result.unit || ''}</td>
        <td style="border: 1px solid #ddd; padding: 8px;">${result.normalRange || ''}</td>
        <td style="border: 1px solid #ddd; padding: 8px; ${flagStyle(result.flag)}">${result.flag || ''}</td>
      </tr>
    `,
      )
      .join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lab Report - ${data.report.reportNumber}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background-color: white;
      padding: 40px;
      border: 1px solid #ddd;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 2px solid #333;
      padding-bottom: 20px;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      color: #333;
    }
    .header-info {
      font-size: 12px;
      color: #666;
      margin-top: 10px;
    }
    .section {
      margin-bottom: 25px;
    }
    .section h2 {
      font-size: 14px;
      font-weight: bold;
      margin: 0 0 15px 0;
      border-bottom: 1px solid #999;
      padding-bottom: 10px;
      color: #333;
    }
    .section-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .info-item {
      font-size: 13px;
      margin-bottom: 8px;
    }
    .info-label {
      font-weight: bold;
      color: #333;
    }
    .info-value {
      color: #666;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th {
      background-color: #f0f0f0;
      border: 1px solid #ddd;
      padding: 10px;
      text-align: left;
      font-weight: bold;
      font-size: 12px;
    }
    td {
      border: 1px solid #ddd;
      padding: 8px;
      font-size: 12px;
    }
    tr:nth-child(even) {
      background-color: #fafafa;
    }
    .notes {
      background-color: #f9f9f9;
      padding: 15px;
      border-left: 3px solid #999;
      margin-top: 10px;
      font-size: 12px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      text-align: center;
      font-size: 11px;
      color: #999;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
    }
    .status-draft {
      background-color: #fff3cd;
      color: #856404;
    }
    .status-final {
      background-color: #d4edda;
      color: #155724;
    }
    @media print {
      body {
        background-color: white;
      }
      .container {
        border: none;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${data.lab.name}</h1>
      <div class="header-info">
        <div>Code: ${data.lab.code} | Mobile: ${data.lab.mobile} ${data.lab.email ? '| Email: ' + data.lab.email : ''}</div>
        ${data.lab.address ? '<div>Address: ' + data.lab.address + '</div>' : ''}
      </div>
    </div>

    <div class="section">
      <h2>Patient Information</h2>
      <div class="section-content">
        <div>
          <div class="info-item"><span class="info-label">Name:</span> <span class="info-value">${data.patient.name}</span></div>
          <div class="info-item"><span class="info-label">Age:</span> <span class="info-value">${data.patient.age || 'N/A'}</span></div>
          <div class="info-item"><span class="info-label">Gender:</span> <span class="info-value">${data.patient.gender}</span></div>
        </div>
        <div>
          <div class="info-item"><span class="info-label">Mobile:</span> <span class="info-value">${data.patient.mobile || 'N/A'}</span></div>
          <div class="info-item"><span class="info-label">Email:</span> <span class="info-value">${data.patient.email || 'N/A'}</span></div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Test Information</h2>
      <div class="section-content">
        <div>
          <div class="info-item"><span class="info-label">Test Name:</span> <span class="info-value">${data.test.name}</span></div>
          <div class="info-item"><span class="info-label">Category:</span> <span class="info-value">${data.test.category || 'N/A'}</span></div>
        </div>
        <div>
          <div class="info-item"><span class="info-label">Report Number:</span> <span class="info-value">${data.report.reportNumber}</span></div>
          <div class="info-item"><span class="info-label">Status:</span> <span class="info-value"><span class="status-badge status-${data.report.status.toLowerCase()}">${data.report.status}</span></span></div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Test Results</h2>
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Result</th>
            <th>Unit</th>
            <th>Normal Range</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          ${resultsRows}
        </tbody>
      </table>
    </div>

    ${data.report.remarks || data.report.doctorNotes ? '<div class="section"><h2>Additional Information</h2><div class="notes">' + (data.report.remarks ? '<div><strong>Remarks:</strong> ' + data.report.remarks + '</div>' : '') + (data.report.doctorNotes ? '<div><strong>Doctor Notes:</strong> ' + data.report.doctorNotes + '</div>' : '') + '</div></div>' : ''}

    <div class="footer">
      <p>Generated on ${new Date().toLocaleString()}</p>
      <p>Report Status: ${data.report.status} | Lab: ${data.lab.code}</p>
    </div>
  </div>
</body>
</html>
    `;
  }
}

