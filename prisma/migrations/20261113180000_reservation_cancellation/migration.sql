-- Cancelación con motivo (#108): columnas opcionales, sin backfill. Las reservas ya canceladas
-- quedan con motivo vacío y el panel muestra «Sin motivo registrado» en vez de inventar uno.
ALTER TABLE "Reservation"
ADD COLUMN "cancellationReason" TEXT,
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledByName" TEXT;
