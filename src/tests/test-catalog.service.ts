import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

@Injectable()
export class TestCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(_user: AuthUser, query: { search?: string; category?: string; department?: string; skip?: string; take?: string }) {
    const search = query.search?.trim();
    const skip = query.skip === undefined ? 0 : Number(query.skip);
    const take = query.take === undefined ? 50 : Number(query.take);
    if (!Number.isInteger(skip) || skip < 0) throw new BadRequestException('skip must be a non-negative integer');
    if (!Number.isInteger(take) || take < 1 || take > 100) throw new BadRequestException('take must be between 1 and 100');
    const where = {
      isActive: true,
      ...(query.category ? { category: query.category.trim() } : {}),
      ...(query.department ? { department: query.department.trim() } : {}),
      ...(search
        ? { OR: [
            { code: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
            { shortName: { contains: search, mode: 'insensitive' as const } },
          ] }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.testDefinition.findMany({
        where,
        select: { id: true, code: true, shortName: true, name: true, category: true, department: true, specimenType: true, container: true, method: true, tat: true, fasting: true, isActive: true, parameters: { orderBy: { displayOrder: 'asc' } } },
        orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.testDefinition.count({ where }),
    ]);
    return { data, pagination: { total, skip, take, pages: Math.ceil(total / take) } };
  }

  async findOne(_user: AuthUser, id: string) {
    const definition = await this.prisma.testDefinition.findFirst({
      where: { id, isActive: true },
      include: { parameters: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!definition) throw new NotFoundException('Test catalog definition not found');
    return definition;
  }

  async categories(_user: AuthUser) {
    const rows = await this.prisma.testDefinition.findMany({
      where: { isActive: true },
      select: { category: true, department: true },
      distinct: ['category', 'department'],
      orderBy: [{ department: 'asc' }, { category: 'asc' }],
    });
    return rows;
  }
}
