-- Planillas de salida (DUT / Registro de salida de pasajeros) compartidas por link público.
-- Aditiva: no toca ninguna tabla existente. Idempotente para poder aplicarse sobre bases que
-- ya tengan parte del esquema (típico de una demo creada con `db push`).

CREATE TABLE IF NOT EXISTS "DepartureSheet" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "destination" TEXT,
    "departureAt" TIMESTAMP(3),
    "borderCrossing" TEXT,
    "notes" TEXT,
    "token" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartureSheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DepartureSheet_token_key" ON "DepartureSheet"("token");
CREATE INDEX IF NOT EXISTS "DepartureSheet_kind_departureAt_idx" ON "DepartureSheet"("kind", "departureAt");

CREATE TABLE IF NOT EXISTS "DepartureSheetPassenger" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "birthDate" DATE NOT NULL,
    "nationality" TEXT NOT NULL,
    "occupation" TEXT,
    "residenceCountry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartureSheetPassenger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DepartureSheetPassenger_sheetId_documentType_documentNumber_key"
    ON "DepartureSheetPassenger"("sheetId", "documentType", "documentNumber");
CREATE INDEX IF NOT EXISTS "DepartureSheetPassenger_sheetId_position_idx"
    ON "DepartureSheetPassenger"("sheetId", "position");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DepartureSheetPassenger_sheetId_fkey'
  ) THEN
    ALTER TABLE "DepartureSheetPassenger"
      ADD CONSTRAINT "DepartureSheetPassenger_sheetId_fkey"
      FOREIGN KEY ("sheetId") REFERENCES "DepartureSheet"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
