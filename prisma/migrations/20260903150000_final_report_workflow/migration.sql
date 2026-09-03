-- CreateTable
CREATE TABLE "FinalReport" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "finalizedById" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinalReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinalReport_orderId_key" ON "FinalReport"("orderId");
CREATE UNIQUE INDEX "FinalReport_reportNumber_key" ON "FinalReport"("reportNumber");
CREATE INDEX "FinalReport_labId_finalizedAt_idx" ON "FinalReport"("labId", "finalizedAt");

-- AddForeignKey
ALTER TABLE "FinalReport" ADD CONSTRAINT "FinalReport_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinalReport" ADD CONSTRAINT "FinalReport_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinalReport" ADD CONSTRAINT "FinalReport_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
