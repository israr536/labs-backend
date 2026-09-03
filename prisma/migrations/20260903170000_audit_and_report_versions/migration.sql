CREATE TYPE "AuditAction" AS ENUM ('CREATE','UPDATE','DELETE','VERIFY','FINALIZE','AMEND','LOGIN','LOGOUT','DOWNLOAD');

ALTER TABLE "FinalReport" ADD COLUMN "currentVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "FinalReportVersion" (
  "id" TEXT NOT NULL,
  "finalReportId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "amendmentReason" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinalReportVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FinalReportVersion_finalReportId_version_key" ON "FinalReportVersion"("finalReportId","version");
CREATE INDEX "FinalReportVersion_createdById_idx" ON "FinalReportVersion"("createdById");
ALTER TABLE "FinalReportVersion" ADD CONSTRAINT "FinalReportVersion_finalReportId_fkey" FOREIGN KEY ("finalReportId") REFERENCES "FinalReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinalReportVersion" ADD CONSTRAINT "FinalReportVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" "AuditAction" NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT,
  "metadata" JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_labId_createdAt_idx" ON "AuditLog"("labId","createdAt");
CREATE INDEX "AuditLog_labId_entity_entityId_idx" ON "AuditLog"("labId","entity","entityId");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
