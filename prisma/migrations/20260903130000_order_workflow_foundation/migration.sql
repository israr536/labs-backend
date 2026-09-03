-- Order workflow foundation. This migration is additive and intentionally does not remove
-- the existing Report -> Test relationship, allowing a staged application rollout.

CREATE TYPE "OrderStatus" AS ENUM ('REGISTERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'RESULT_ENTERED', 'VERIFIED', 'FINAL', 'CANCELLED');
CREATE TYPE "SampleStatus" AS ENUM ('PENDING', 'COLLECTED', 'RECEIVED', 'PROCESSING', 'COMPLETED', 'REJECTED');

CREATE TABLE "LabOrder" (
  "id" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'REGISTERED',
  "referredBy" TEXT,
  "clinicalNotes" TEXT,
  "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "testId" TEXT NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sample" (
  "id" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "accessionNumber" TEXT NOT NULL,
  "specimenType" TEXT NOT NULL,
  "container" TEXT,
  "status" "SampleStatus" NOT NULL DEFAULT 'PENDING',
  "collectedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LabOrder_labId_orderNumber_key" ON "LabOrder"("labId", "orderNumber");
CREATE INDEX "LabOrder_labId_patientId_createdAt_idx" ON "LabOrder"("labId", "patientId", "createdAt");
CREATE INDEX "LabOrder_labId_status_createdAt_idx" ON "LabOrder"("labId", "status", "createdAt");
CREATE UNIQUE INDEX "OrderItem_orderId_testId_key" ON "OrderItem"("orderId", "testId");
CREATE INDEX "OrderItem_testId_idx" ON "OrderItem"("testId");
CREATE UNIQUE INDEX "Sample_labId_accessionNumber_key" ON "Sample"("labId", "accessionNumber");
CREATE INDEX "Sample_labId_orderId_idx" ON "Sample"("labId", "orderId");
CREATE INDEX "Sample_labId_status_idx" ON "Sample"("labId", "status");

ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
