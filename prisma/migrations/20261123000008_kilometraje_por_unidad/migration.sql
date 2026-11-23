-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "serviceIntervalKm" INTEGER;

-- AlterTable
ALTER TABLE "VehicleServiceSheet" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "VehicleOdometerReading" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "km" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'PANEL',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleOdometerReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleOdometerReading_vehicleId_readAt_idx" ON "VehicleOdometerReading"("vehicleId", "readAt");

-- AddForeignKey
ALTER TABLE "VehicleOdometerReading" ADD CONSTRAINT "VehicleOdometerReading_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
