-- Aditiva: vuelos que hace una sola camioneta en la misma vuelta. Nullable, sin default ni backfill.
ALTER TABLE "Flight" ADD COLUMN "pickupGroupId" TEXT;

CREATE INDEX "Flight_pickupGroupId_idx" ON "Flight"("pickupGroupId");
