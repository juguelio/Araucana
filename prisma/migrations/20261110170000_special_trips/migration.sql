-- CreateTable
CREATE TABLE "SpecialTrip" (
    "id" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "client" TEXT NOT NULL,
    "contact" TEXT,
    "passengers" INTEGER,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "legs" JSONB NOT NULL,
    "destinationSearch" TEXT NOT NULL,
    "billingMode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "totalCents" INTEGER,
    "payments" JSONB NOT NULL,
    "supplier" TEXT,
    "invoice" TEXT,
    "invoiceDate" DATE,
    "paymentStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialTripAssignment" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialTripAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialTripSource" (
    "id" TEXT NOT NULL,
    "tripId" TEXT,
    "sheet" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "original" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "issues" JSONB NOT NULL,

    CONSTRAINT "SpecialTripSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetConflictAcceptance" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "acceptedBy" TEXT NOT NULL,
    "conflicts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetConflictAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialTrip_serviceDate_status_idx" ON "SpecialTrip"("serviceDate", "status");

-- CreateIndex
CREATE INDEX "SpecialTripAssignment_vehicleId_startsAt_endsAt_idx" ON "SpecialTripAssignment"("vehicleId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "SpecialTripAssignment_tripId_idx" ON "SpecialTripAssignment"("tripId");

-- CreateIndex
CREATE INDEX "SpecialTripSource_tripId_idx" ON "SpecialTripSource"("tripId");

-- CreateIndex
CREATE INDEX "FleetConflictAcceptance_service_serviceId_idx" ON "FleetConflictAcceptance"("service", "serviceId");

-- AddForeignKey
ALTER TABLE "SpecialTripAssignment" ADD CONSTRAINT "SpecialTripAssignment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "SpecialTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialTripAssignment" ADD CONSTRAINT "SpecialTripAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialTripAssignment" ADD CONSTRAINT "SpecialTripAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialTripSource" ADD CONSTRAINT "SpecialTripSource_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "SpecialTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
