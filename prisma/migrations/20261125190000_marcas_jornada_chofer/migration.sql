ALTER TABLE "DriverVehicleLocation" ADD COLUMN "servicioId" TEXT;
ALTER TABLE "DriverLocationSample" ADD COLUMN "servicioId" TEXT;
CREATE TABLE "DriverServiceMark" (
    "id" TEXT PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "vehicleId" TEXT,
    "tipo" TEXT NOT NULL CHECK ("tipo" IN ('inicio', 'fin', 'embarque')),
    "filaId" TEXT,
    "cantidad" INTEGER,
    "prevista" INTEGER,
    "at" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL CHECK ("estado" IN ('guardada', 'revision')),
    "motivo" TEXT,
    "servicio" TEXT NOT NULL,
    "nave" TEXT,
    "fila" TEXT
);
CREATE INDEX "DriverServiceMark_fecha_servicioId_idx" ON "DriverServiceMark" ("fecha", "servicioId");
CREATE INDEX "DriverServiceMark_driverId_fecha_idx" ON "DriverServiceMark" ("driverId", "fecha");
CREATE INDEX "DriverServiceMark_servicioId_vehicleId_tipo_idx" ON "DriverServiceMark" ("servicioId", "vehicleId", "tipo");
