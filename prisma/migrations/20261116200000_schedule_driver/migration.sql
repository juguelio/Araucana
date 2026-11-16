-- Issue #174: chofer de cada salida de ruta, asignable desde «Salidas del día».
-- Columna opcional: las salidas existentes quedan sin chofer y nada cambia para ellas.
ALTER TABLE "Schedule" ADD COLUMN "driverId" TEXT;

CREATE INDEX "Schedule_driverId_idx" ON "Schedule"("driverId");

ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
