-- Boleto numerado del servicio público (issue #370).
-- Serie W única y continua para toda la empresa: el número se consume al emitir y nunca se reutiliza.
CREATE TABLE "TicketSeries" (
    "id" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketSeries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketSeries_series_key" ON "TicketSeries"("series");

-- La serie web existe desde la migración: sin la fila, la primera emisión no tendría contador.
INSERT INTO "TicketSeries" ("id", "series", "nextNumber", "createdAt", "updatedAt")
VALUES ('tkserie_w', 'W', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("series") DO NOTHING;

CREATE TABLE "ServiceTicket" (
    "id" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "displayNumber" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EMITIDO',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "issuedByName" TEXT,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "departureAt" TIMESTAMP(3),
    "fareCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "paymentMethod" TEXT,
    "annulledAt" TIMESTAMP(3),
    "annulledById" TEXT,
    "annulledByName" TEXT,
    "annulReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceTicket_series_number_key" ON "ServiceTicket"("series", "number");
CREATE UNIQUE INDEX "ServiceTicket_reservationId_key" ON "ServiceTicket"("reservationId");
CREATE INDEX "ServiceTicket_status_idx" ON "ServiceTicket"("status");
CREATE INDEX "ServiceTicket_displayNumber_idx" ON "ServiceTicket"("displayNumber");

ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_seriesId_fkey"
    FOREIGN KEY ("seriesId") REFERENCES "TicketSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
