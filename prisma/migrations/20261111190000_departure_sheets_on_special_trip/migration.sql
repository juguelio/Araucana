-- La planilla pasa de la reserva al viaje especial: es ahí donde la agencia carga los viajes que
-- salen de la provincia o del país (los traslados locales no llevan planilla).
--
-- La tabla está vacía (el feature se mergeó hoy y todavía no se generó ningún link), así que se
-- puede exigir `specialTripId NOT NULL` sin backfill.

ALTER TABLE "DepartureSheet" DROP CONSTRAINT IF EXISTS "DepartureSheet_reservationId_fkey";
DROP INDEX IF EXISTS "DepartureSheet_reservationId_kind_key";
ALTER TABLE "DepartureSheet" DROP COLUMN "reservationId";

ALTER TABLE "DepartureSheet" ADD COLUMN "specialTripId" TEXT NOT NULL;
ALTER TABLE "DepartureSheet"
  ADD CONSTRAINT "DepartureSheet_specialTripId_fkey"
  FOREIGN KEY ("specialTripId") REFERENCES "SpecialTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DepartureSheet_specialTripId_kind_key" ON "DepartureSheet"("specialTripId", "kind");
