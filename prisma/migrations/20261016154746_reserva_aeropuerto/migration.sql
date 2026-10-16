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

-- CreateIndex
CREATE UNIQUE INDEX "AirportReservationDetails_reservationId_key" ON "AirportReservationDetails"("reservationId");

-- CreateIndex
CREATE INDEX "AirportReservationDetails_serviceDate_direction_idx" ON "AirportReservationDetails"("serviceDate", "direction");

-- CreateIndex
CREATE INDEX "AirportReservationDetails_flightNumber_idx" ON "AirportReservationDetails"("flightNumber");

-- AddForeignKey
ALTER TABLE "AirportReservationDetails" ADD CONSTRAINT "AirportReservationDetails_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportReservationDetails" ADD CONSTRAINT "AirportReservationDetails_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE SET NULL ON UPDATE CASCADE;
