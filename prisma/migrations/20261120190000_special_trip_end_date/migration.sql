-- Viajes especiales de varios días: día de la vuelta. Nullable: los viajes existentes quedan de un día.
ALTER TABLE "SpecialTrip" ADD COLUMN "endDate" DATE;

-- CreateIndex
CREATE INDEX "SpecialTrip_endDate_idx" ON "SpecialTrip"("endDate");
