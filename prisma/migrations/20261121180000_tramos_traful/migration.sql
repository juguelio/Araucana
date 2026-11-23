ALTER TABLE "Reservation" ADD COLUMN "boardingStop" TEXT;

-- Tarifas de cabecera vigentes desde el 18 de julio de 2026, en centavos.
UPDATE "TravelRoute"
SET "priceCents" = CASE WHEN lower(trim("from")) = 'villa la angostura'
                          OR lower(trim("to")) = 'villa la angostura' THEN 1900000 ELSE 3000000 END
WHERE "bookingMode" = 'SEATED' AND "currency" = 'ARS'
  AND ((lower(trim("from")) = 'villa traful' AND lower(trim("to")) IN ('san martin de los andes', 'san martín de los andes', 'villa la angostura'))
    OR (lower(trim("to")) = 'villa traful' AND lower(trim("from")) IN ('san martin de los andes', 'san martín de los andes', 'villa la angostura')));
