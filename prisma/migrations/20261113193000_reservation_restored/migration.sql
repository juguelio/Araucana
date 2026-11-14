-- Restitución de una reserva cancelada (#117): quién y cuándo se volvió atrás.
-- Aditiva y sin relleno: las reservas canceladas que ya existen quedan en NULL, que es además el
-- único valor posible para las que nunca se restituyeron.
ALTER TABLE "Reservation"
ADD COLUMN "restoredAt" TIMESTAMP(3),
ADD COLUMN "restoredByName" TEXT;
