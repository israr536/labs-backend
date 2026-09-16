CREATE INDEX "AuditLog_labId_entity_entityId_action_createdAt_idx"
ON "AuditLog"("labId", "entity", "entityId", "action", "createdAt");
