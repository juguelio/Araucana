-- Orden de servicio por nave: en qué nave va cada pasajero y su lugar en la recorrida.
-- Columnas nulas: el código anterior las ignora y `null` es "lo decide la orden".
ALTER TABLE "AirportReservationDetails" ADD COLUMN "assignmentId" TEXT;
ALTER TABLE "AirportReservationDetails" ADD COLUMN "routePosition" INTEGER;

CREATE INDEX "AirportReservationDetails_assignmentId_idx" ON "AirportReservationDetails"("assignmentId");

ALTER TABLE "AirportReservationDetails" ADD CONSTRAINT "AirportReservationDetails_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AirportVehicleAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
