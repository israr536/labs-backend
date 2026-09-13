CREATE TYPE "CriticalResultStatus" AS ENUM ('PENDING', 'NOTIFIED', 'ACKNOWLEDGED', 'SUPERSEDED');
CREATE TYPE "CriticalNotificationMethod" AS ENUM ('PHONE', 'IN_PERSON', 'ELECTRONIC', 'OTHER');

CREATE TABLE "CriticalResult" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "labId" TEXT NOT NULL,
  "orderResultId" UUID NOT NULL,
  "patientId" TEXT NOT NULL,
  "testId" TEXT NOT NULL,
  "parameterId" TEXT NOT NULL,
  "occurrence" INTEGER NOT NULL DEFAULT 1,
  "value" TEXT NOT NULL,
  "unit" TEXT,
  "direction" TEXT NOT NULL,
  "criticalThreshold" DOUBLE PRECISION,
  "referenceRangeSnapshot" JSONB,
  "status" "CriticalResultStatus" NOT NULL DEFAULT 'PENDING',
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notifiedAt" TIMESTAMP(3),
  "notifiedTo" TEXT,
  "notifiedById" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "acknowledgementNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CriticalResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CriticalResult_orderResultId_fkey" FOREIGN KEY ("orderResultId") REFERENCES "OrderResult"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CriticalResult_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CriticalResult_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CriticalResult_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CriticalResult_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "TestParameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CriticalResult_notifiedById_fkey" FOREIGN KEY ("notifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CriticalResult_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CriticalResult_direction_check" CHECK ("direction" IN ('LOW', 'HIGH'))
);

CREATE UNIQUE INDEX "CriticalResult_orderResultId_occurrence_key" ON "CriticalResult"("orderResultId", "occurrence");
CREATE INDEX "CriticalResult_labId_status_isCurrent_detectedAt_idx" ON "CriticalResult"("labId", "status", "isCurrent", "detectedAt");
CREATE INDEX "CriticalResult_patientId_idx" ON "CriticalResult"("patientId");
CREATE INDEX "CriticalResult_parameterId_idx" ON "CriticalResult"("parameterId");

CREATE TABLE "CriticalNotificationAttempt" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "criticalResultId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "method" "CriticalNotificationMethod" NOT NULL,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contactedName" TEXT,
  "contactDetails" TEXT,
  "successful" BOOLEAN NOT NULL DEFAULT false,
  "readBackConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "attemptedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CriticalNotificationAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CriticalNotificationAttempt_criticalResultId_fkey" FOREIGN KEY ("criticalResultId") REFERENCES "CriticalResult"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CriticalNotificationAttempt_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CriticalNotificationAttempt_attemptedById_fkey" FOREIGN KEY ("attemptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CriticalNotificationAttempt_labId_criticalResultId_attemptedAt_idx" ON "CriticalNotificationAttempt"("labId", "criticalResultId", "attemptedAt");

CREATE OR REPLACE FUNCTION "sync_critical_result"() RETURNS trigger AS $$
DECLARE
  critical_low DOUBLE PRECISION;
  critical_high DOUBLE PRECISION;
  lab_id TEXT;
  patient_id TEXT;
  test_id TEXT;
  unit_value TEXT;
  numeric_value DOUBLE PRECISION;
  direction_value TEXT;
  threshold_value DOUBLE PRECISION;
  current_record RECORD;
  next_occurrence INTEGER;
  new_id TEXT;
BEGIN
  SELECT tp."criticalLow", tp."criticalHigh", tp."unit", lo."labId", lo."patientId", oi."testId"
    INTO critical_low, critical_high, unit_value, lab_id, patient_id, test_id
  FROM "TestParameter" tp
  JOIN "OrderItem" oi ON oi.id = NEW."orderItemId"
  JOIN "LabOrder" lo ON lo.id = oi."orderId"
  WHERE tp.id = NEW."parameterId";

  IF NEW."value" !~ '^[+-]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)$' THEN
    UPDATE "CriticalResult" SET "isCurrent" = false, "status" = 'SUPERSEDED', "updatedAt" = CURRENT_TIMESTAMP
    WHERE "orderResultId" = NEW.id AND "isCurrent" = true;
    RETURN NEW;
  END IF;

  numeric_value := NEW."value"::DOUBLE PRECISION;
  direction_value := NULL;
  threshold_value := NULL;

  IF critical_low IS NOT NULL AND numeric_value < critical_low THEN
    direction_value := 'LOW';
    threshold_value := critical_low;
  ELSIF critical_high IS NOT NULL AND numeric_value > critical_high THEN
    direction_value := 'HIGH';
    threshold_value := critical_high;
  END IF;

  SELECT * INTO current_record
  FROM "CriticalResult"
  WHERE "orderResultId" = NEW.id AND "isCurrent" = true
  ORDER BY "occurrence" DESC
  LIMIT 1;

  IF direction_value IS NULL THEN
    IF current_record.id IS NOT NULL THEN
      UPDATE "CriticalResult" SET "isCurrent" = false, "status" = 'SUPERSEDED', "updatedAt" = CURRENT_TIMESTAMP WHERE id = current_record.id;
    END IF;
    RETURN NEW;
  END IF;

  IF current_record.id IS NOT NULL
     AND current_record."value" = NEW."value"
     AND current_record."direction" = direction_value
     AND current_record."criticalThreshold" IS NOT DISTINCT FROM threshold_value
     AND current_record."status" <> 'SUPERSEDED' THEN
    RETURN NEW;
  END IF;

  IF current_record.id IS NOT NULL THEN
    UPDATE "CriticalResult" SET "isCurrent" = false, "status" = 'SUPERSEDED', "updatedAt" = CURRENT_TIMESTAMP WHERE id = current_record.id;
  END IF;

  SELECT COALESCE(MAX("occurrence"), 0) + 1 INTO next_occurrence FROM "CriticalResult" WHERE "orderResultId" = NEW.id;
  INSERT INTO "CriticalResult" ("labId", "orderResultId", "patientId", "testId", "parameterId", "occurrence", "value", "unit", "direction", "criticalThreshold", "referenceRangeSnapshot", "status", "isCurrent")
  VALUES (lab_id, NEW.id, patient_id, test_id, NEW."parameterId", next_occurrence, NEW."value", unit_value, direction_value, threshold_value, NEW."referenceRangeSnapshot", 'PENDING', true)
  RETURNING id INTO new_id;

  INSERT INTO "AuditLog" ("labId", "actorId", "action", "entity", "entityId", "metadata")
  VALUES (lab_id, NULL, 'UPDATE', 'CriticalResult', new_id, jsonb_build_object('operation','CRITICAL_RESULT_DETECTED','orderResultId',NEW.id,'direction',direction_value,'threshold',threshold_value));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrderResult_critical_result_trigger"
AFTER INSERT OR UPDATE OF "value", "parameterId", "referenceRangeSnapshot" ON "OrderResult"
FOR EACH ROW EXECUTE FUNCTION "sync_critical_result"();
