-- Production workflow hardening
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PATHOLOGIST';

ALTER TABLE "LabOrder"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "LabOrder_labId_status_revision_idx"
ON "LabOrder"("labId", "status", "revision");
