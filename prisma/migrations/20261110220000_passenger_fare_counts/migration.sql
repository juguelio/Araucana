-- Tarifas por edad (issue #33): media tarifa para 4 a 8 años y sin cargo para menores de 4.
-- Los pasajeros siguen dentro de "passengerCount" (total de lugares ocupados): estos contadores
-- sólo dicen cuántos de esos lugares no pagan tarifa entera.
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "halfFareCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "freeFareCount" INTEGER NOT NULL DEFAULT 0;

-- Lo que el aeropuerto ya guardaba en su tabla de detalle pasa a las columnas comunes.
-- Va con SQL dinámico porque en una base que viene de `db push` esa columna puede no existir.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'AirportReservationDetails' AND column_name = 'halfFareCount'
  ) THEN
    EXECUTE '
      UPDATE "Reservation" AS r
      SET "halfFareCount" = d."halfFareCount"
      FROM "AirportReservationDetails" AS d
      WHERE d."reservationId" = r."id" AND d."halfFareCount" > 0';
  END IF;
END $$;
