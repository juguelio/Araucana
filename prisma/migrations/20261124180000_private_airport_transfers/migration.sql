ALTER TABLE "AirportReservationDetails"
  ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "privateStops" JSONB;

ALTER TABLE "AirportVehicleAssignment" ADD COLUMN "privateReservationId" TEXT
  REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "AirportVehicleAssignment_privateReservationId_key"
  ON "AirportVehicleAssignment"("privateReservationId");
