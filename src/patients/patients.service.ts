import { Injectable, NotFoundException } from '@nestjs/common';
import { Gender } from '@prisma/client';
import { enumValue, optionalDate, optionalInteger, optionalString, requiredString } from '../common/validation';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../labs/subscription.service';

interface PatientBody { name?: unknown; dateOfBirth?: unknown; age?: unknown; gender?: unknown; mobile?: unknown; email?: unknown; address?: unknown }

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService, private readonly subscriptionService: SubscriptionService) {}

  async create(currentUser: AuthUser, body: PatientBody) {
    const data = {
      labId: currentUser.labId,
      name: requiredString(body.name, 'name'),
      dateOfBirth: optionalDate(body.dateOfBirth, 'dateOfBirth'),
      age: optionalInteger(body.age, 'age'),
      gender: enumValue(Gender, body.gender, 'gender'),
      mobile: optionalString(body.mobile, 'mobile'),
      email: optionalString(body.email, 'email'),
      address: optionalString(body.address, 'address'),
    };

    return this.prisma.$transaction(async (tx) => {
      await this.subscriptionService.lockLimit(tx, currentUser.labId, 'patients');
      await this.subscriptionService.assertWithinLimit(currentUser.labId, 'patients', 1, tx);
      return tx.patient.create({ data });
    });
  }

  async count(currentUser: AuthUser) {
    return { count: await this.prisma.patient.count({ where: { labId: currentUser.labId } }) };
  }

  findAll(currentUser: AuthUser, search?: string, limitValue?: string) {
    const parsedLimit = limitValue === undefined ? 100 : Number(limitValue);
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 100;
    return this.prisma.patient.findMany({
      where: { labId: currentUser.labId, ...(search ? { OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { mobile: { contains: search, mode: 'insensitive' as const } },
      { email: { contains: search, mode: 'insensitive' as const } },
    ] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, name: true, dateOfBirth: true, age: true, gender: true, mobile: true, email: true, address: true, createdAt: true, updatedAt: true },
    });
  }

  async findOne(currentUser: AuthUser, id: string) {
    const patient = await this.prisma.patient.findFirst({ where: { id, labId: currentUser.labId } });
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  async update(currentUser: AuthUser, id: string, body: PatientBody) {
    const data = {
      name: body.name === undefined ? undefined : requiredString(body.name, 'name'),
      dateOfBirth: body.dateOfBirth === undefined ? undefined : optionalDate(body.dateOfBirth, 'dateOfBirth'),
      age: body.age === undefined ? undefined : optionalInteger(body.age, 'age'),
      gender: body.gender === undefined ? undefined : enumValue(Gender, body.gender, 'gender'),
      mobile: body.mobile === undefined ? undefined : optionalString(body.mobile, 'mobile'),
      email: body.email === undefined ? undefined : optionalString(body.email, 'email'),
      address: body.address === undefined ? undefined : optionalString(body.address, 'address'),
    };

    const rows = await this.prisma.patient.updateManyAndReturn({
      where: { id, labId: currentUser.labId },
      data,
    });
    if (rows.length !== 1) throw new NotFoundException('Patient not found');
    return rows[0];
  }

  async remove(currentUser: AuthUser, id: string) {
    await this.findOne(currentUser, id);
    await this.prisma.patient.delete({ where: { id } });
    return { success: true };
  }
}
