CREATE TABLE "SchoolRun" (
    "id" TEXT PRIMARY KEY,
    "serviceDate" DATE NOT NULL,
    "routeName" TEXT NOT NULL,
    "shift" TEXT NOT NULL,
    "driverId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "vehicleId" TEXT REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "companion" TEXT,
    "notes" TEXT,
    "review" TEXT,
    "source" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "SchoolRun_serviceDate_routeName_idx" ON "SchoolRun"("serviceDate", "routeName");
