DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_attribute WHERE attrelid = '"SchoolRun"'::regclass AND attname = 'panelLegacyKind' AND NOT attisdropped) THEN
    UPDATE "SchoolRun" SET "kind" = CASE "panelLegacyKind" WHEN 'PERSONAL' THEN 'personal-aeropuerto' ELSE 'escuela' END;
    ALTER TABLE "SchoolRun" DROP COLUMN "panelLegacyKind";
  END IF;
END $$;
