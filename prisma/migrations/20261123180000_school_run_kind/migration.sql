-- Concesiones agrupa servicios recurrentes: escuelas, personal de aeropuerto y otros.
ALTER TABLE "SchoolRun" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'escuela';
