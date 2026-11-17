-- Varias naves por salida de ruta: la primera sigue en "Schedule"."vehicleId"; las demás van acá.
-- Tabla nueva: no cambia ninguna fila existente.
CREATE TABLE "ScheduleUnit" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduleUnit_scheduleId_vehicleId_key" ON "ScheduleUnit"("scheduleId", "vehicleId");
CREATE INDEX "ScheduleUnit_vehicleId_idx" ON "ScheduleUnit"("vehicleId");
CREATE INDEX "ScheduleUnit_driverId_idx" ON "ScheduleUnit"("driverId");

ALTER TABLE "ScheduleUnit" ADD CONSTRAINT "ScheduleUnit_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleUnit" ADD CONSTRAINT "ScheduleUnit_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduleUnit" ADD CONSTRAINT "ScheduleUnit_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
