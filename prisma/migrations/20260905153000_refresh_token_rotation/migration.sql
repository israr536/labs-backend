-- Refresh-token rotation and replay detection.
ALTER TABLE "RefreshToken"
  ADD COLUMN "familyId" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN "usedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
