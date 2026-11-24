BEGIN;
CREATE INDEX "AirportVehicleAssignment_privateReservationId_idx" ON "AirportVehicleAssignment"("privateReservationId");
DROP INDEX "AirportVehicleAssignment_privateReservationId_key";
COMMIT;
