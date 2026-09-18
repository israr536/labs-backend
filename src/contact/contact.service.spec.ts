import { BadRequestException } from '@nestjs/common';
import { ContactService } from './contact.service';

describe('ContactService', () => {
  it('persists a valid inquiry and returns a public-safe receipt', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'inquiry-1', createdAt: new Date('2026-09-19T00:00:00.000Z') });
    const service = new ContactService({ contactInquiry: { create } } as never);

    const result = await service.createInquiry({ name: 'Lab Owner', email: 'OWNER@EXAMPLE.COM', topic: 'sales', message: 'Please arrange a demo.' });

    expect(create).toHaveBeenCalledWith({
      data: { name: 'Lab Owner', email: 'owner@example.com', topic: 'sales', message: 'Please arrange a demo.' },
      select: { id: true, createdAt: true },
    });
    expect(result.success).toBe(true);
    expect(result.inquiryId).toBe('inquiry-1');
  });

  it('rejects invalid email and unsupported topics', async () => {
    const service = new ContactService({ contactInquiry: { create: jest.fn() } } as never);
    await expect(service.createInquiry({ name: 'Owner', email: 'not-an-email', topic: 'sales', message: 'Hello' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createInquiry({ name: 'Owner', email: 'owner@example.com', topic: 'unknown', message: 'Hello' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
