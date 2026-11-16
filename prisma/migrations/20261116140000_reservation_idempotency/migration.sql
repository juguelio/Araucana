-- Idempotencia del alta de reservas (#139).
--
-- La columna es nullable a propósito: las reservas que ya existen no tienen clave y un índice
-- único en Postgres acepta cualquier cantidad de NULL. No hace falta backfill ni escribir datos
-- del cliente, así que la migración es puramente aditiva (ADD COLUMN + CREATE INDEX).

ALTER TABLE "Reservation" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Reservation_idempotencyKey_key" ON "Reservation"("idempotencyKey");
