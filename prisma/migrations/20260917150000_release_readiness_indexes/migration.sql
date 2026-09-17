CREATE INDEX "TestDefinition_active_department_category_name_idx"
  ON "TestDefinition"("isActive", "department", "category", "name");

CREATE INDEX IF NOT EXISTS "CriticalResult_labId_isCurrent_status_detectedAt_idx"
  ON "CriticalResult"("labId", "isCurrent", "status", "detectedAt");

CREATE INDEX IF NOT EXISTS "CriticalNotificationAttempt_criticalResultId_labId_attemptedAt_idx"
  ON "CriticalNotificationAttempt"("criticalResultId", "labId", "attemptedAt");
