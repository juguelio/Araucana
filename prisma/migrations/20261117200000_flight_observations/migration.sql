-- Observaciones por fuente de los vuelos del aeropuerto (modo sombra). Sólo aditivo.
CREATE TABLE "FlightObservation" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" TEXT NOT NULL,
    "rawNumber" TEXT NOT NULL,
    "canonicalNumber" TEXT NOT NULL,
    "airline" TEXT,
    "codeshareOf" TEXT,
    "origin" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "estimatedAt" TIMESTAMP(3),
    "status" TEXT,
    "rawStatus" TEXT,
    "localDay" TEXT,
    "dayInferred" BOOLEAN NOT NULL DEFAULT false,
    "matchKey" TEXT,
    "syncOutcome" TEXT NOT NULL,
    "flightId" TEXT,
    "matcherFlightId" TEXT,
    "matchLevel" TEXT NOT NULL,
    "discrepancy" TEXT,
    "payload" JSONB,

    CONSTRAINT "FlightObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FlightObservation_syncRunId_idx" ON "FlightObservation"("syncRunId");
CREATE INDEX "FlightObservation_localDay_direction_idx" ON "FlightObservation"("localDay", "direction");
CREATE INDEX "FlightObservation_matchKey_idx" ON "FlightObservation"("matchKey");
CREATE INDEX "FlightObservation_flightId_idx" ON "FlightObservation"("flightId");

ALTER TABLE "FlightObservation" ADD CONSTRAINT "FlightObservation_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE SET NULL ON UPDATE CASCADE;
