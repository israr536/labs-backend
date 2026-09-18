-- Allow report creation without collecting sex/gender.
-- Existing patient records are preserved; only the NOT NULL constraint is removed.
ALTER TABLE "Patient"
ALTER COLUMN "gender" DROP NOT NULL;
