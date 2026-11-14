-- Ventas de excursión (issue #110): la planilla que se entrega por una excursión tiene que tener la
-- misma forma que la orden de servicio del chofer, incluida la columna «Derivado por».
CREATE TABLE "ExcursionBooking" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "excursionId" TEXT NOT NULL,
    "departureAt" TIMESTAMP(3) NOT NULL,
    "passengerId" TEXT NOT NULL,
    "passengerCount" INTEGER NOT NULL DEFAULT 1,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "referredBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExcursionBooking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExcursionBooking_code_key" ON "ExcursionBooking"("code");
CREATE UNIQUE INDEX "ExcursionBooking_shortCode_key" ON "ExcursionBooking"("shortCode");
CREATE INDEX "ExcursionBooking_departureAt_idx" ON "ExcursionBooking"("departureAt");
CREATE INDEX "ExcursionBooking_excursionId_departureAt_idx" ON "ExcursionBooking"("excursionId", "departureAt");

ALTER TABLE "ExcursionBooking" ADD CONSTRAINT "ExcursionBooking_excursionId_fkey"
    FOREIGN KEY ("excursionId") REFERENCES "Excursion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExcursionBooking" ADD CONSTRAINT "ExcursionBooking_passengerId_fkey"
    FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
