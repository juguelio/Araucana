-- Documentación de los choferes: DNI, licencia de conducir y certificado de antecedentes.
-- Tabla nueva: las cuentas existentes no cambian.
CREATE TABLE "DriverProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "cuil" TEXT,
    "licenseCategory" TEXT NOT NULL,
    "licenseScope" TEXT NOT NULL DEFAULT 'COMPLETA',
    "licenseExpiresAt" TIMESTAMP(3) NOT NULL,
    "criminalRecordExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");
CREATE INDEX "DriverProfile_documentNumber_idx" ON "DriverProfile"("documentNumber");

ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
