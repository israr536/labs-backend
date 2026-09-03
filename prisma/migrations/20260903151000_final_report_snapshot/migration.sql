-- AlterTable
ALTER TABLE "FinalReport" ADD COLUMN "snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Remove the temporary default after existing rows (if any) have been backfilled.
ALTER TABLE "FinalReport" ALTER COLUMN "snapshot" DROP DEFAULT;
