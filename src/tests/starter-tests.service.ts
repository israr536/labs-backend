import { Injectable } from '@nestjs/common';
import { ParameterInputType } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../labs/subscription.service';
import { DEFAULT_TEST_TEMPLATES } from './default-test-templates';

@Injectable()
export class StarterTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async provision(currentUser: AuthUser) {
    const results: Array<{ code: string; status: 'created' | 'already-enabled' }> = [];

    for (const template of DEFAULT_TEST_TEMPLATES) {
      const existing = await this.prisma.test.findUnique({
        where: { labId_code: { labId: currentUser.labId, code: template.code } },
        select: { id: true },
      });

      if (existing) {
        results.push({ code: template.code, status: 'already-enabled' });
        continue;
      }

      const catalog = await this.prisma.testDefinition.findFirst({
        where: {
          isActive: true,
          OR: [{ code: template.code }, { name: template.name }],
        },
        select: { id: true },
      });

      await this.prisma.$transaction(async (tx) => {
        await this.subscriptionService.lockLimit(tx, currentUser.labId, 'tests');
        await this.subscriptionService.assertWithinLimit(currentUser.labId, 'tests', 1, tx);

        await tx.test.create({
          data: {
            labId: currentUser.labId,
            catalogId: catalog?.id ?? null,
            code: template.code,
            shortName: template.code,
            name: template.name,
            category: template.category,
            department: template.department,
            sampleType: template.sampleType,
            method: template.method ?? null,
            tat: template.tat ?? null,
            isActive: true,
            parameters: {
              create: template.parameters.map((parameter, index) => ({
                name: parameter.name,
                inputType: parameter.inputType as ParameterInputType,
                unit: parameter.unit ?? null,
                normalMin: parameter.normalMin ?? null,
                normalMax: parameter.normalMax ?? null,
                decimalPlaces: parameter.decimalPlaces ?? null,
                displayOrder: parameter.displayOrder ?? index,
                isRequired: parameter.isRequired ?? true,
              })),
            },
          },
        });
      });

      results.push({ code: template.code, status: 'created' });
    }

    return { tests: results };
  }
}
