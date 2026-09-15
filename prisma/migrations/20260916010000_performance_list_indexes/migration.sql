CREATE INDEX "Patient_labId_createdAt_idx" ON "Patient"("labId", "createdAt");
CREATE INDEX "LabOrder_labId_createdAt_idx" ON "LabOrder"("labId", "createdAt");
