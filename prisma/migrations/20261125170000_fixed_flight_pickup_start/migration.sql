BEGIN;

ALTER TABLE "Flight" ADD COLUMN "pickupStartInitialAt" TIMESTAMP(3);

-- Conservar la recorrida que ya figuraba en el tablero antes de la migración.
-- El FIDS usa 00:00 de Argentina para indicar una estimación desconocida.
UPDATE "Flight"
SET "pickupStartInitialAt" = COALESCE(
  CASE WHEN "source" = 'FIDS' AND to_char("estimatedAt" - INTERVAL '3 hours', 'HH24:MI') = '00:00'
    THEN NULL ELSE "estimatedAt" END,
  "scheduledAt"
) - INTERVAL '150 minutes'
WHERE "direction" = 'DEPARTURE';

CREATE FUNCTION initialize_flight_pickup_start() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."pickupStartInitialAt" := NEW."scheduledAt" - INTERVAL '150 minutes';
  RETURN NEW;
END;
$$;

CREATE TRIGGER flight_initial_pickup_start
BEFORE INSERT ON "Flight"
FOR EACH ROW WHEN (NEW."direction" = 'DEPARTURE')
EXECUTE FUNCTION initialize_flight_pickup_start();

COMMIT;
