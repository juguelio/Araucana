-- Derivación de otra agencia (#109): quién vendió la reserva, como texto libre.
-- Aditiva y sin backfill: las reservas que ya existen quedan en NULL y la columna «Derivado por»
-- de la orden de servicio sigue saliendo vacía, igual que hoy.
ALTER TABLE "Reservation" ADD COLUMN "referredBy" TEXT;
