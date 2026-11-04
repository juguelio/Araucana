-- Ficha de flota: datos registrales y vencimientos de cada unidad.
-- Aditiva: sólo agrega columnas nullable (y defaults), no toca filas existentes.
ALTER TABLE "Vehicle" ADD COLUMN     "acquiredAt" TIMESTAMP(3),
ADD COLUMN     "insurer" TEXT,
ADD COLUMN     "internalNumber" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CAMIONETA',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "owner" TEXT,
ADD COLUMN     "policyDueAt" TIMESTAMP(3),
ADD COLUMN     "publicTransport" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rtoDueAt" TIMESTAMP(3),
ADD COLUMN     "technicalInspectionDueAt" TIMESTAMP(3),
ADD COLUMN     "year" INTEGER;

CREATE INDEX "Vehicle_internalNumber_idx" ON "Vehicle"("internalNumber");
CREATE INDEX "Vehicle_licensePlate_idx" ON "Vehicle"("licensePlate");
