-- Additive migration for order-centric result entry and verification.
CREATE TABLE "OrderResult" (
  "id" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "parameterId" TEXT NOT NULL,
  "sampleId" TEXT,
  "value" TEXT NOT NULL,
  "flag" "ResultFlag",
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderResult_orderItemId_parameterId_key" ON "OrderResult"("orderItemId", "parameterId");
CREATE INDEX "OrderResult_parameterId_idx" ON "OrderResult"("parameterId");
CREATE INDEX "OrderResult_sampleId_idx" ON "OrderResult"("sampleId");
CREATE INDEX "OrderResult_verifiedById_idx" ON "OrderResult"("verifiedById");

ALTER TABLE "OrderResult" ADD CONSTRAINT "OrderResult_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderResult" ADD CONSTRAINT "OrderResult_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "TestParameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderResult" ADD CONSTRAINT "OrderResult_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE SET NULL ON UPDATE CASCADE;
