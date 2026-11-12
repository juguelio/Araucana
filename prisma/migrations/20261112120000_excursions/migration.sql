-- Catálogo editorial de excursiones. Migración aditiva; no altera reservas/rutas.
CREATE TABLE "Excursion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Excursion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ExcursionPhoto" (
    "id" TEXT NOT NULL,
    "excursionId" TEXT NOT NULL,
    "blobPathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExcursionPhoto_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ExcursionDeparture" (
    "id" TEXT NOT NULL,
    "excursionId" TEXT NOT NULL,
    "departureAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExcursionDeparture_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Excursion_isPublished_name_idx" ON "Excursion"("isPublished", "name");
CREATE INDEX "ExcursionPhoto_excursionId_position_idx" ON "ExcursionPhoto"("excursionId", "position");
CREATE INDEX "ExcursionDeparture_departureAt_idx" ON "ExcursionDeparture"("departureAt");
CREATE UNIQUE INDEX "ExcursionDeparture_excursionId_departureAt_key" ON "ExcursionDeparture"("excursionId", "departureAt");
ALTER TABLE "ExcursionPhoto" ADD CONSTRAINT "ExcursionPhoto_excursionId_fkey" FOREIGN KEY ("excursionId") REFERENCES "Excursion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExcursionDeparture" ADD CONSTRAINT "ExcursionDeparture_excursionId_fkey" FOREIGN KEY ("excursionId") REFERENCES "Excursion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
