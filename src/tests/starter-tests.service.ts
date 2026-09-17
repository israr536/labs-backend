import { Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_TEST_TEMPLATES } from './default-test-templates';

@Injectable()
export class StarterTestsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Starter tests are now available through the shared catalog by default.
   * Keep this endpoint for older clients, but make it read-only and cheap.
   */
  async provision(_currentUser: AuthUser) {
    const catalog = await this.prisma.testDefinition.findMany({
      where: { isActive: true, code: { in: DEFAULT_TEST_TEMPLATES.map((template) => template.code) } },
      select: { code: true },
    });
    const available = new Set(catalog.map((item) => item.code));
    return {
      tests: DEFAULT_TEST_TEMPLATES
        .filter((template) => available.has(template.code))
        .map((template) => ({ code: template.code, status: 'already-enabled' as const })),
    };
  }
}
