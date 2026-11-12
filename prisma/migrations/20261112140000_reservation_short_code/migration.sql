-- Código corto de la reserva (issue #75): el que se dicta por teléfono, se imprime en el
-- comprobante y se tipea en el buscador del panel. No reemplaza a "code": ese sigue siendo
-- la capability del link privado del pasajero y no cambia.
ALTER TABLE "Reservation" ADD COLUMN "shortCode" TEXT;

-- Relleno de las reservas que ya existen: 8 caracteres del alfabeto sin ambigüedad, derivados
-- del id (40 bits) para que no haya que correr ningún script después del deploy.
UPDATE "Reservation" AS r
SET "shortCode" = (
  SELECT string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(decode(substr(md5(r."id"), (i * 2) - 1, 2), 'hex'), 0) % 32) + 1, 1),
    ''
  )
  FROM generate_series(1, 8) AS i
)
WHERE r."shortCode" IS NULL;

ALTER TABLE "Reservation" ALTER COLUMN "shortCode" SET NOT NULL;

CREATE UNIQUE INDEX "Reservation_shortCode_key" ON "Reservation"("shortCode");
