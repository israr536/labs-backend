ALTER TABLE "Patient" ADD COLUMN "email" TEXT;

ALTER TABLE "Report" ADD COLUMN "referredBy" TEXT;
ALTER TABLE "Report" ADD COLUMN "sampleCollectedAt" TIMESTAMP(3);

CREATE TABLE "PendingLabRegistration" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "adminUsername" TEXT NOT NULL,
    "adminMobile" TEXT NOT NULL,
    "adminEmail" TEXT,
    "adminPasswordHash" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingLabRegistration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingLabRegistration_code_idx" ON "PendingLabRegistration"("code");
CREATE INDEX "PendingLabRegistration_adminUsername_idx" ON "PendingLabRegistration"("adminUsername");
CREATE INDEX "PendingLabRegistration_expiresAt_idx" ON "PendingLabRegistration"("expiresAt");
