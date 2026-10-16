-- CreateTable
CREATE TABLE "AirportVehicleAssignment" (
    "id" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AirportVehicleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AirportVehicleAssignment_flightId_idx" ON "AirportVehicleAssignment"("flightId");

-- CreateIndex
CREATE UNIQUE INDEX "AirportVehicleAssignment_flightId_vehicleId_key" ON "AirportVehicleAssignment"("flightId", "vehicleId");

-- AddForeignKey
ALTER TABLE "AirportVehicleAssignment" ADD CONSTRAINT "AirportVehicleAssignment_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportVehicleAssignment" ADD CONSTRAINT "AirportVehicleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportVehicleAssignment" ADD CONSTRAINT "AirportVehicleAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
