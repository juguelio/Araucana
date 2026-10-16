-- DropForeignKey
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_scheduleId_fkey";

-- DropForeignKey
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_seatId_fkey";

-- AlterTable
ALTER TABLE "Vehicle" ALTER COLUMN "updatedAt" DROP DEFAULT;

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

-- CreateIndex
CREATE INDEX "Flight_scheduledAt_idx" ON "Flight"("scheduledAt");

-- CreateIndex
CREATE INDEX "Flight_status_idx" ON "Flight"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Flight_number_scheduledAt_direction_key" ON "Flight"("number", "scheduledAt", "direction");

-- CreateIndex
CREATE INDEX "FlightEvent_flightId_detectedAt_idx" ON "FlightEvent"("flightId", "detectedAt");

-- AddForeignKey
ALTER TABLE "FlightEvent" ADD CONSTRAINT "FlightEvent_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
