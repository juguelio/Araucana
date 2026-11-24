-- Sólo las instalaciones anteriores del PR tienen la restricción y los valores en mayúsculas.
-- Apartar esa columna antes de la migración de Concesiones permite conservar sus recorridos.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_constraint WHERE conrelid = '"SchoolRun"'::regclass AND conname = 'SchoolRun_kind_check') THEN
    ALTER TABLE "SchoolRun" RENAME COLUMN "kind" TO "panelLegacyKind";
  END IF;
END $$;
