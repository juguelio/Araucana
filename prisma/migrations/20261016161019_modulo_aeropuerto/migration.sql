-- CreateTable
CREATE TABLE "Flight" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "airline" TEXT,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL DEFAULT 'Aeropuerto Chapelco (CPC)',
    "direction" TEXT NOT NULL DEFAULT 'ARRIVAL',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "estimatedAt" TIMESTAMP(3),
    "actualAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "passengers" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightEvent" (
    "id" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "FlightEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirportReservationDetails" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "flightId" TEXT,
    "direction" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "pickupName" TEXT,
    "pickupAddress" TEXT,
    "pickupNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AirportReservationDetails_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "Flight_scheduledAt_idx" ON "Flight"("scheduledAt");

-- CreateIndex
CREATE INDEX "Flight_status_idx" ON "Flight"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Flight_number_scheduledAt_direction_key" ON "Flight"("number", "scheduledAt", "direction");

-- CreateIndex
CREATE INDEX "FlightEvent_flightId_detectedAt_idx" ON "FlightEvent"("flightId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AirportReservationDetails_reservationId_key" ON "AirportReservationDetails"("reservationId");

-- CreateIndex
CREATE INDEX "AirportReservationDetails_serviceDate_direction_idx" ON "AirportReservationDetails"("serviceDate", "direction");

-- CreateIndex
CREATE INDEX "AirportReservationDetails_flightNumber_idx" ON "AirportReservationDetails"("flightNumber");

-- CreateIndex
CREATE INDEX "AirportVehicleAssignment_flightId_idx" ON "AirportVehicleAssignment"("flightId");

-- CreateIndex
CREATE UNIQUE INDEX "AirportVehicleAssignment_flightId_vehicleId_key" ON "AirportVehicleAssignment"("flightId", "vehicleId");

-- AddForeignKey
ALTER TABLE "FlightEvent" ADD CONSTRAINT "FlightEvent_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportReservationDetails" ADD CONSTRAINT "AirportReservationDetails_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportReservationDetails" ADD CONSTRAINT "AirportReservationDetails_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportVehicleAssignment" ADD CONSTRAINT "AirportVehicleAssignment_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportVehicleAssignment" ADD CONSTRAINT "AirportVehicleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportVehicleAssignment" ADD CONSTRAINT "AirportVehicleAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
