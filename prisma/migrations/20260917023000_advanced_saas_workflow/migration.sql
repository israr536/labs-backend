CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdempotencyRecord_labId_key_key" ON "IdempotencyRecord"("labId", "key");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

CREATE TABLE "OutboxEvent" (
  "id" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OutboxEvent_status_availableAt_createdAt_idx" ON "OutboxEvent"("status", "availableAt", "createdAt");
CREATE INDEX "OutboxEvent_labId_aggregateType_aggregateId_idx" ON "OutboxEvent"("labId", "aggregateType", "aggregateId");

CREATE INDEX "TestParameterReferenceRange_parameterId_effectiveFrom_effectiveTo_idx"
  ON "TestParameterReferenceRange"("parameterId", "effectiveFrom", "effectiveTo");
