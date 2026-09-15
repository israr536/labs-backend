import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditAction, OrderStatus, SampleStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FinalReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async finalize(currentUser: AuthUser, orderId: string, loadedOrder?: any) {
    const order = loadedOrder ?? (await this.getOrder(currentUser, orderId));
    if (order.status === OrderStatus.FINAL) return this.getReport(currentUser, orderId);
    if (order.status !== OrderStatus.VERIFIED) {
      throw new BadRequestException('Only verified orders can be finalized');
    }
    if (!order.items.length) throw new BadRequestException('Order has no tests');
    if (!order.samples.length) throw new BadRequestException('Order has no samples');

    const missing: string[] = [];
    for (const item of order.items) {
      const resultsByParameterId = new Map<string, any>(
        item.results.map((row: any) => [row.parameterId, row]),
      );
      for (const parameter of item.test.parameters) {
        const result = resultsByParameterId.get(parameter.id);
        if (parameter.isRequired && (!result || !result.value.trim())) {
          missing.push(`${item.test.name}: ${parameter.name}`);
        }
      }
    }
    if (missing.length) {
      throw new BadRequestException(`Missing required results: ${missing.join(', ')}`);
    }

    const incompleteSamples = order.samples.filter(
      (sample) => sample.status !== SampleStatus.COMPLETED,
    );
    if (incompleteSamples.length) {
      throw new BadRequestException(
        `All samples must be completed before finalization: ${incompleteSamples
          .map((sample) => sample.accessionNumber)
          .join(', ')}`,
      );
    }

    // createFastCompleteOrder already loaded the lab needed for the report.
    // Reuse it during the hot path instead of issuing another Neon query.
    const lab = order.lab ?? (await this.prisma.lab.findUnique({ where: { id: order.labId } }));
    if (!lab) throw new NotFoundException('Lab not found');

    const reportNumber = `RPT-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;

    const snapshot = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      reportNumber,
      patient: order.patient,
      items: order.items,
      samples: order.samples,
      lab,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      const finalReport = await tx.finalReport.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          reportNumber,
          generatedAt: new Date(),
        },
        update: {
          reportNumber,
          generatedAt: new Date(),
        },
      });

      await tx.finalReportVersion.upsert({
        where: {
          finalReportId_version: {
            finalReportId: finalReport.id,
            version: 1,
          },
        },
        create: {
          finalReportId: finalReport.id,
          version: 1,
          snapshot,
        },
        update: { snapshot },
      });

      await tx.labOrder.updateMany({
        where: { id: order.id, status: OrderStatus.VERIFIED },
        data: { status: OrderStatus.FINAL, revision: { increment: 1 } },
      });

      return finalReport;
    });

    await this.audit.record({
      labId: order.labId,
      userId: currentUser.id,
      action: AuditAction.FINALIZE_ORDER,
      entity: 'LabOrder',
      entityId: order.id,
      metadata: { reportId: result.id },
    });

    return result;
  }
}
