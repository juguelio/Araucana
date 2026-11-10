BEGIN;

LOCK TABLE "Flight" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    servicio record;
    duplicado record;
    vuelo_id text;
BEGIN
    -- La fecha operativa de Chapelco se calcula en UTC-3.
    FOR servicio IN
        SELECT 'JA' || right(trim("number"), 4) AS numero,
               "direction",
               ("scheduledAt" - interval '3 hours')::date AS dia
        FROM "Flight"
        WHERE trim("number") ~* '^(JA|WJ)[[:space:]]*318[23]$'
        GROUP BY 1, 2, 3
        HAVING count(*) > 1 OR bool_or("number" NOT IN ('JA3182', 'JA3183'))
    LOOP
        SELECT "id" INTO STRICT vuelo_id
        FROM "Flight"
        WHERE trim("number") ~* ('^(JA|WJ)[[:space:]]*' || right(servicio.numero, 4) || '$')
          AND "direction" = servicio."direction"
          AND ("scheduledAt" - interval '3 hours')::date = servicio.dia
        ORDER BY CASE "source" WHEN 'FIDS' THEN 0 WHEN 'API' THEN 1 WHEN 'MANUAL' THEN 2 ELSE 3 END,
                 ("number" = servicio.numero) DESC, "lastCheckedAt" DESC NULLS LAST, "id"
        LIMIT 1
        FOR UPDATE;

        FOR duplicado IN
            SELECT *
            FROM "Flight"
            WHERE trim("number") ~* ('^(JA|WJ)[[:space:]]*' || right(servicio.numero, 4) || '$')
              AND "direction" = servicio."direction"
              AND ("scheduledAt" - interval '3 hours')::date = servicio.dia
              AND "id" <> vuelo_id
            ORDER BY "updatedAt" DESC, "id"
            FOR UPDATE
        LOOP
            UPDATE "AirportReservationDetails"
            SET "flightId" = vuelo_id, "flightNumber" = servicio.numero, "updatedAt" = now()
            WHERE "flightId" = duplicado."id";

            UPDATE "FlightEvent" SET "flightId" = vuelo_id WHERE "flightId" = duplicado."id";

            -- Una misma combi cuenta una sola vez para el cupo.
            UPDATE "AirportVehicleAssignment" AS principal
            SET "driverId" = coalesce(principal."driverId", otra."driverId"),
                "notes" = nullif(concat_ws(E'\n', principal."notes", otra."notes",
                    CASE WHEN principal."driverId" <> otra."driverId"
                         THEN 'Conductor en la asignación duplicada: ' || otra."driverId" END), ''),
                "updatedAt" = now()
            FROM "AirportVehicleAssignment" AS otra
            WHERE principal."flightId" = vuelo_id
              AND otra."flightId" = duplicado."id"
              AND principal."vehicleId" = otra."vehicleId";

            UPDATE "AirportVehicleAssignment" AS otra
            SET "flightId" = vuelo_id, "updatedAt" = now()
            WHERE otra."flightId" = duplicado."id"
              AND NOT EXISTS (
                  SELECT 1 FROM "AirportVehicleAssignment" AS principal
                  WHERE principal."flightId" = vuelo_id AND principal."vehicleId" = otra."vehicleId"
              );

            UPDATE "Flight"
            SET "pickupStartOverrideAt" = coalesce("pickupStartOverrideAt", duplicado."pickupStartOverrideAt"),
                "actualAt" = coalesce("actualAt", duplicado."actualAt"),
                "passengers" = coalesce("passengers", duplicado."passengers"),
                "notes" = nullif(concat_ws(E'\n', "notes", duplicado."notes"), '')
            WHERE "id" = vuelo_id;

            DELETE FROM "Flight" WHERE "id" = duplicado."id";
        END LOOP;

        UPDATE "Flight"
        SET "number" = servicio.numero, "airline" = 'JA', "updatedAt" = now()
        WHERE "id" = vuelo_id;
    END LOOP;
END
$$;

UPDATE "AirportReservationDetails"
SET "flightNumber" = 'JA' || right(trim("flightNumber"), 4), "updatedAt" = now()
WHERE trim("flightNumber") ~* '^(JA|WJ)[[:space:]]*318[23]$'
  AND "flightNumber" NOT IN ('JA3182', 'JA3183');

-- Evita que dos cargas simultáneas creen el mismo servicio con horarios distintos.
CREATE UNIQUE INDEX IF NOT EXISTS "Flight_jetsmart_local_day_key"
ON "Flight" (right(trim("number"), 4), "direction", (("scheduledAt" - interval '3 hours')::date))
WHERE trim("number") ~* '^(JA|WJ)[[:space:]]*318[23]$';

COMMIT;
