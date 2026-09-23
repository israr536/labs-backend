CREATE TABLE "RazorpayWebhookEvent" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RazorpayWebhookEvent_providerEventId_key" ON "RazorpayWebhookEvent"("providerEventId");
CREATE INDEX "RazorpayWebhookEvent_eventType_receivedAt_idx" ON "RazorpayWebhookEvent"("eventType", "receivedAt");