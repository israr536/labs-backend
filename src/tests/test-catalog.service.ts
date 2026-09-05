import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

@Injectable()
export class TestCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(_user: AuthUser, query: { search?: string; category?: string; department?: string }) {
    const search = query.search?.trim();
    return this.prisma.testDefinition.findMany({
      where: {
        isActive: true,
        ...(query.category ? { category: query.category } : {}),
        ...(query.department ? { department: query.department } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { shortName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { parameters: { orderBy: { displayOrder: 'asc' } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
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
