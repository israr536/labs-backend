import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class OtpDeliveryService {
  async sendSignupOtp(to: string, otp: string, expiresAt: Date) {
    if (process.env.NODE_ENV !== 'production') return { delivered: false, mode: 'development' as const };

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.OTP_FROM_EMAIL?.trim();
    if (!apiKey || !from) {
      throw new ServiceUnavailableException('Production OTP delivery is not configured. Set RESEND_API_KEY and OTP_FROM_EMAIL.');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'Verify your laboratory account',
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2>Verify your laboratory account</h2><p>Your signup verification code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${otp}</p><p>This code expires at ${expiresAt.toISOString()}.</p><p>If you did not request this signup, you can ignore this email.</p></div>`,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ServiceUnavailableException(`Unable to deliver signup OTP${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    return { delivered: true, mode: 'resend' as const };
  }
}
