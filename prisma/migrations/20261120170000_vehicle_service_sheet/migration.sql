-- Aditiva: planilla de service por nave (fecha, kilometraje, ítems revisados y qué se hizo).
-- Tabla nueva; no toca datos existentes.
CREATE TABLE "VehicleServiceSheet" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "servicedAt" TIMESTAMP(3) NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '{}',
    "workDone" TEXT,
    "notes" TEXT,
    "reportedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleServiceSheet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VehicleServiceSheet_vehicleId_servicedAt_idx" ON "VehicleServiceSheet"("vehicleId", "servicedAt");

ALTER TABLE "VehicleServiceSheet" ADD CONSTRAINT "VehicleServiceSheet_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
