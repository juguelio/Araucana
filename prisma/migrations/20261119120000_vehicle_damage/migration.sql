-- Aditiva: daños de cada nave, anotados desde su ficha. Tabla nueva, sin tocar datos existentes.
CREATE TABLE "VehicleDamage" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'LEVE',
    "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "repairedAt" TIMESTAMP(3),
    "repairEntryId" TEXT,
    "reportedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleDamage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VehicleDamage_vehicleId_occurredAt_idx" ON "VehicleDamage"("vehicleId", "occurredAt");
CREATE INDEX "VehicleDamage_repairEntryId_idx" ON "VehicleDamage"("repairEntryId");

ALTER TABLE "VehicleDamage" ADD CONSTRAINT "VehicleDamage_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleDamage" ADD CONSTRAINT "VehicleDamage_repairEntryId_fkey" FOREIGN KEY ("repairEntryId") REFERENCES "AccountingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
