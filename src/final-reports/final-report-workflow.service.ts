import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, OrderStatus, SampleStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinalReportsService } from './final-reports.service';

@Injectable()
export class FinalReportWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reports: FinalReportsService,
  ) {}

  async finalize(currentUser: AuthUser, orderId: string) {
    const report = await this.prisma.finalReport.findFirst({
      where: { orderId, labId: currentUser.labId },
      select: { id: true, finalizedAt: true },
    });

    if (report) {
      const pending = await this.prisma.auditLog.findFirst({
        where: {
          labId: currentUser.labId,
          entity: 'FinalReport',
          entityId: report.id,
          action: AuditAction.AMEND,
          createdAt: { gt: report.finalizedAt },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (pending?.metadata && typeof pending.metadata === 'object' && !Array.isArray(pending.metadata)) {
        const phase = (pending.metadata as Record<string, unknown>).phase;
        if (phase === 'STARTED') {
          throw new BadRequestException('This report is in amendment review. Complete the amendment release workflow before finalizing it.');
        }
      }
    }

    return this.reports.finalize(currentUser, orderId);
  }

  async startAmendment(currentUser: AuthUser, orderId: string, reasonValue: unknown) {
    const reason = typeof reasonValue === 'string' ? reasonValue.trim() : '';
    if (reason.length < 5 || reason.length > 500) {
      throw new BadRequestException('Amendment reason must be between 5 and 500 characters');
    }

    const report = await this.prisma.finalReport.findFirst({
      where: { orderId, labId: currentUser.labId },
      select: { id: true, reportNumber: true, currentVersion: true, finalizedAt: true },
    });
    if (!report) throw new NotFoundException('Final report not found');

    const order = await this.prisma.labOrder.findFirst({
      where: { id: orderId, labId: currentUser.labId },
      select: { id: true, status: true, revision: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.FINAL) {
      throw new BadRequestException('Only a finalized report can start an amendment');
    }

    const existingPending = await this.prisma.auditLog.findFirst({
      where: {
        labId: currentUser.labId,
        entity: 'FinalReport',
        entityId: report.id,
        action: AuditAction.AMEND,
        createdAt: { gt: report.finalizedAt },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingPending?.metadata && typeof existingPending.metadata === 'object' && !Array.isArray(existingPending.metadata)) {
      if ((existingPending.metadata as Record<string, unknown>).phase === 'STARTED') {
        throw new ConflictException('An amendment is already in progress for this report');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.labOrder.updateMany({
        where: { id: order.id, labId: currentUser.labId, revision: order.revision, status: OrderStatus.FINAL },
        data: { status: OrderStatus.RESULT_ENTERED, revision: { increment: 1 } },
      });
      if (locked.count !== 1) {
        throw new ConflictException('This report changed while the amendment was starting. Reload and try again.');
      }
      return tx.finalReport.findUnique({ where: { id: report.id }, select: { id: true, reportNumber: true, currentVersion: true } });
    });

    await this.audit.record(currentUser, AuditAction.AMEND, 'FinalReport', report.id, {
      orderId,
      reportNumber: report.reportNumber,
      version: report.currentVersion,
      reason,
      phase: 'STARTED',
    });

    return {
      reportId: updated?.id ?? report.id,
      reportNumber: updated?.reportNumber ?? report.reportNumber,
      version: updated?.currentVersion ?? report.currentVersion,
      status: OrderStatus.RESULT_ENTERED,
      amendmentReason: reason,
      message: 'Amendment started. Update the results, verify them, then release the amended report.',
    };
  }

  async releaseAmendment(currentUser: AuthUser, orderId: string) {
    const report = await this.prisma.finalReport.findFirst({
      where: { orderId, labId: currentUser.labId },
      select: { id: true, reportNumber: true, currentVersion: true, finalizedAt: true },
    });
    if (!report) throw new NotFoundException('Final report not found');

    const pending = await this.prisma.auditLog.findFirst({
      where: {
        labId: currentUser.labId,
        entity: 'FinalReport',
        entityId: report.id,
        action: AuditAction.AMEND,
        createdAt: { gt: report.finalizedAt },
      },
      orderBy: { createdAt: 'desc' },
    });
    const metadata = pending?.metadata && typeof pending.metadata === 'object' && !Array.isArray(pending.metadata)
      ? pending.metadata as Record<string, unknown>
      : null;
    const amendmentReason = metadata && typeof metadata.reason === 'string' ? metadata.reason : null;
    if (!metadata || metadata.phase !== 'STARTED' || amendmentReason === null) {
      throw new BadRequestException('No pending amendment is available for release');
    }

    const order = await this.getOrder(currentUser, orderId);
    if (order.status !== OrderStatus.VERIFIED) {
      throw new BadRequestException('Amended results must be verified before the revised report can be released');
    }
    if (!order.items.length) throw new BadRequestException('Order has no tests');
    if (!order.samples.length) throw new BadRequestException('Order has no samples');

    const missing: string[] = [];
    for (const item of order.items) {
      for (const parameter of item.test.parameters) {
        const result = item.results.find((row) => row.parameterId === parameter.id);
        if (parameter.isRequired && (!result || !result.value.trim())) missing.push(`${item.test.name}: ${parameter.name}`);
      }
    }
    if (missing.length) throw new BadRequestException(`Missing required results: ${missing.join(', ')}`);

    const incompleteSamples = order.samples.filter((sample) => sample.status !== SampleStatus.COMPLETED);
    if (incompleteSamples.length) throw new BadRequestException('All samples must be completed before releasing the amended report');

    const lab = await this.prisma.lab.findUnique({
      where: { id: currentUser.labId },
      select: { id: true, code: true, name: true, mobile: true, email: true, address: true },
    });
    if (!lab) throw new NotFoundException('Lab not found');

    const releasedAt = new Date();
    const nextVersion = report.currentVersion + 1;
    const snapshot = this.buildSnapshot(lab, order, releasedAt);

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.labOrder.updateMany({
        where: { id: order.id, labId: currentUser.labId, status: OrderStatus.VERIFIED },
        data: { status: OrderStatus.FINAL, revision: { increment: 1 } },
      });
      if (locked.count !== 1) throw new ConflictException('This order changed while releasing the amendment. Reload and try again.');

      await tx.finalReportVersion.create({
        data: {
          finalReportId: report.id,
          version: nextVersion,
          snapshot,
          amendmentReason,
          createdById: currentUser.id,
        },
      });

      await tx.finalReport.update({
        where: { id: report.id },
        data: { snapshot, currentVersion: nextVersion, finalizedById: currentUser.id, finalizedAt: releasedAt },
      });
    });

    await this.audit.record(currentUser, AuditAction.AMEND, 'FinalReport', report.id, {
      orderId,
      reportNumber: report.reportNumber,
      version: nextVersion,
      reason: amendmentReason,
      phase: 'RELEASED',
    });
    await this.audit.record(currentUser, AuditAction.FINALIZE, 'FinalReport', report.id, {
      orderId,
      reportNumber: report.reportNumber,
      version: nextVersion,
      amended: true,
    });

    return this.reports.getReport(currentUser, orderId);
  }

  private async getOrder(currentUser: AuthUser, orderId: string) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id: orderId, labId: currentUser.labId },
      include: {
        patient: true,
        samples: true,
        items: {
          include: {
            test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } },
            results: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private buildSnapshot(lab: any, order: any, finalizedAt: Date) {
    return {
      lab,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: OrderStatus.FINAL,
        referredBy: order.referredBy,
        clinicalNotes: order.clinicalNotes,
        orderedAt: order.orderedAt,
        patient: order.patient,
        samples: order.samples,
        tests: order.items.map((item: any) => ({
          orderItemId: item.id,
          test: {
            id: item.test.id,
            code: item.test.code,
            name: item.test.name,
            category: item.test.category,
            department: item.test.department,
            sampleType: item.test.sampleType,
            method: item.test.method,
          },
          parameters: item.test.parameters.map((parameter: any) => {
            const result = item.results.find((row: any) => row.parameterId === parameter.id);
            return {
              parameterId: parameter.id,
              name: parameter.name,
              value: result?.value ?? null,
              unit: parameter.unit,
              referenceRange: parameter.referenceRange,
              normalMin: parameter.normalMin,
              normalMax: parameter.normalMax,
              flag: result?.flag ?? null,
              displayOrder: parameter.displayOrder,
            };
          }),
        })),
      },
      finalizedAt,
    };
  }
}
