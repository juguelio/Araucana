-- La planilla de salida pasa a colgar de una reserva existente: el panel le manda el link al
-- pasajero de esa reserva en lugar de crear una planilla suelta con título, destino y fecha.
-- Aditiva sobre la tabla vacía que creó 20261111130000_departure_sheets.

ALTER TABLE "DepartureSheet" ADD COLUMN IF NOT EXISTS "reservationId" TEXT;

-- Si quedara alguna planilla suelta (sin reserva) no se borra en silencio: el NOT NULL falla y
-- obliga a decidir a mano.
ALTER TABLE "DepartureSheet" ALTER COLUMN "reservationId" SET NOT NULL;

ALTER TABLE "DepartureSheet" DROP COLUMN IF EXISTS "title";
ALTER TABLE "DepartureSheet" DROP COLUMN IF EXISTS "destination";
ALTER TABLE "DepartureSheet" DROP COLUMN IF EXISTS "departureAt";
ALTER TABLE "DepartureSheet" DROP COLUMN IF EXISTS "borderCrossing";
ALTER TABLE "DepartureSheet" DROP COLUMN IF EXISTS "notes";

DROP INDEX IF EXISTS "DepartureSheet_kind_departureAt_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "DepartureSheet_reservationId_kind_key"
    ON "DepartureSheet"("reservationId", "kind");
CREATE INDEX IF NOT EXISTS "DepartureSheet_kind_idx" ON "DepartureSheet"("kind");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DepartureSheet_reservationId_fkey'
  ) THEN
    ALTER TABLE "DepartureSheet"
      ADD CONSTRAINT "DepartureSheet_reservationId_fkey"
      FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
