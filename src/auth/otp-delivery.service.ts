import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OtpDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  async sendSignupOtp(adminEmail: string, otp: string, _expiresAt: Date) {
    const mode = process.env.OTP_DELIVERY_MODE?.trim().toLowerCase();

    // Temporary production mode: generate/verify OTP locally without calling 2Factor.
    if (mode === 'local') {
      return { delivered: false, mode: 'local' as const };
    }

    const pending = await this.prisma.pendingLabRegistration.findFirst({ where: { OR: [{ adminEmail }, { adminUsername: adminEmail }] }, select: { adminMobile: true } });
    const mobile = pending?.adminMobile;
    if (!mobile) throw new ServiceUnavailableException('Signup mobile number was not found. Please start signup again.');
    return this.sendSms(mobile, otp, 'signup');
  }

  async sendPasswordResetOtp(mobile: string, otp: string, _expiresAt: Date) {
    const mode = process.env.OTP_DELIVERY_MODE?.trim().toLowerCase();
    if (mode === 'local') {
      return { delivered: false, mode: 'local' as const };
    }
    return this.sendSms(mobile, otp, 'password reset');
  }

  private async sendSms(mobile: string, otp: string, purpose: string) {
    if (process.env.NODE_ENV !== 'production') return { delivered: false, mode: 'development' as const };
    const apiKey = process.env.TWOFACTOR_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException('Production OTP delivery is not configured. Set TWOFACTOR_API_KEY.');
    const phone = normalizeIndianMobile(mobile);
    const url = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(phone)}/${encodeURIComponent(otp)}`;
    const response = await fetch(url, { method: 'GET' });
    const detail = await response.text().catch(() => '');
    let payload: { Status?: string; Details?: string } = {};
    try {
      payload = JSON.parse(detail) as { Status?: string; Details?: string };
    } catch {
      // Ignore malformed provider response; the response status below determines delivery success.
    }
    if (!response.ok || payload.Status !== 'Success') throw new ServiceUnavailableException(`Unable to deliver ${purpose} OTP${payload.Details ? `: ${payload.Details}` : ''}`);
    return { delivered: true, mode: '2factor' as const };
  }
}

function normalizeIndianMobile(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (value.trim().startsWith('+') && digits.length >= 10) return digits;
  throw new ServiceUnavailableException('Please provide a valid Indian mobile number.');
}
