CREATE TABLE "DriverPlanNotice" (
    "serviceDate" DATE NOT NULL,
    "driverId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedBy" TEXT NOT NULL,
    CONSTRAINT "DriverPlanNotice_pkey" PRIMARY KEY ("serviceDate", "driverId")
);
