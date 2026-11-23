ALTER TABLE "SpecialTripAssignment" ADD COLUMN "coDriverId" TEXT;
ALTER TABLE "SpecialTripAssignment" ADD CONSTRAINT "SpecialTripAssignment_coDriverId_fkey"
  FOREIGN KEY ("coDriverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SpecialTripAssignment" ADD CONSTRAINT "SpecialTripAssignment_distinct_drivers"
  CHECK ("driverId" IS DISTINCT FROM "coDriverId" OR "driverId" IS NULL);
