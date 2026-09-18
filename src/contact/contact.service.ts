import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requiredString } from '../common/validation';

export type ContactInquiryBody = {
  name?: unknown;
  email?: unknown;
  topic?: unknown;
  message?: unknown;
};

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  async createInquiry(body: ContactInquiryBody) {
    const name = requiredString(body.name, 'name');
    const email = requiredString(body.email, 'email').toLowerCase();
    const topic = requiredString(body.topic, 'topic');
    const message = requiredString(body.message, 'message');

    if (name.length > 120) throw new BadRequestException('name is too long');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      throw new BadRequestException('email must be valid');
    }
    if (message.length > 5000) throw new BadRequestException('message is too long');
    if (!['support', 'onboarding', 'sales', 'feedback'].includes(topic)) {
      throw new BadRequestException('topic is invalid');
    }

    const inquiry = await this.prisma.contactInquiry.create({
      data: { name, email, topic, message },
      select: { id: true, createdAt: true },
    });

    return { success: true, inquiryId: inquiry.id, createdAt: inquiry.createdAt };
  }
}
