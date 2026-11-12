-- Ida y vuelta del aeropuerto (#36): enlace entre las dos reservas de un mismo viaje.
-- Aditiva y sin backfill: las reservas que ya existen son de un solo tramo (roundTripId NULL).
ALTER TABLE "Reservation" ADD COLUMN "roundTripId" TEXT;

CREATE INDEX "Reservation_roundTripId_idx" ON "Reservation"("roundTripId");
