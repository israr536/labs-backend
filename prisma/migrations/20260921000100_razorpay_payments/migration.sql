CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "providerOrderId" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "plan" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "signature" TEXT,
  "notes" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");
CREATE INDEX "Payment_labId_createdAt_idx" ON "Payment"("labId","createdAt");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status","createdAt");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
