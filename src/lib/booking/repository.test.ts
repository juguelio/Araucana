import { describe, expect, it, vi } from "vitest";
import { BookingError, createBookingRepository } from "./repository";
import type { CreateReservationInput } from "./validation";

type RouteRecord = {
  id: string;
  slug: string;
  from: string;
  to: string;
  via: string;
  durationMin: number;
  priceCents: number;
  currency: string;
  category: string;
  description: string;
  featured: boolean;
  isActive: boolean;
  stops: unknown;
};

type VehicleRecord = {
  id: string;
  name: string;
  seats: SeatRecord[];
};

type SeatRecord = {
  id: string;
  vehicleId: string;
  number: string;
  row: number;
  column: number;
};

type ScheduleRecord = {
  id: string;
  routeId: string;
  vehicleId: string;
  departureAt: Date;
  arrivalAt: Date;
  status: string;
  route: RouteRecord;
  vehicle: VehicleRecord;
};

type PassengerRecord = CreateReservationInput["passenger"] & {
  id: string;
};

type ReservationRecord = {
  id: string;
  code: string;
  scheduleId: string;
  passengerId: string;
  seatId: string;
  seatNumber: string;
  status: string;
  totalCents: number;
  currency: string;
  createdAt: Date;
  schedule: ScheduleRecord;
  passenger: PassengerRecord;
  payment?: PaymentRecord;
  ticket?: TicketRecord;
};

type PaymentRecord = {
  id: string;
  reservationId: string;
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  externalRef: string | null;
  receiptBlobUrl?: string | null;
  receiptBlobPathname?: string | null;
  receiptFileName?: string | null;
  receiptContentType?: string | null;
  receiptSize?: number | null;
  receiptUploadedAt?: Date | null;
};

type TicketRecord = {
  id: string;
  reservationId: string;
  code: string;
  qrPayload: string;
};

class FakeBookingClient {
  route: RouteRecord;
  inactiveRoute: RouteRecord;
  seats: SeatRecord[];
  vehicle: VehicleRecord;
  scheduleRecord: ScheduleRecord;
  passengers: PassengerRecord[] = [];
  reservations: ReservationRecord[] = [];
  payments: PaymentRecord[] = [];
  tickets: TicketRecord[] = [];
  transactionCallCount = 0;
  onBeforeReservationCreate?: () => void;
  private activeTransactionAborted = false;

  constructor() {
    this.route = {
      id: "route-1",
      slug: "sma-bariloche-7-lagos",
      from: "SMA",
      to: "Bariloche",
      via: "Camino de los 7 Lagos",
      durationMin: 270,
      priceCents: 1890000,
      currency: "ARS",
      category: "Argentina",
      description: "Ruta escenica",
      featured: true,
      isActive: true,
      stops: []
    };
    this.inactiveRoute = {
      ...this.route,
      id: "route-inactive",
      slug: "sma-junin-inactiva",
      from: "SMA",
      to: "Junin",
      featured: false,
      isActive: false
    };
    this.seats = [
      { id: "seat-04", vehicleId: "vehicle-1", number: "04", row: 1, column: 4 },
      { id: "seat-05", vehicleId: "vehicle-1", number: "05", row: 2, column: 1 }
    ];
    this.vehicle = {
      id: "vehicle-1",
      name: "Araucana 24",
      seats: this.seats
    };
    this.scheduleRecord = {
      id: "schedule-1",
      routeId: this.route.id,
      vehicleId: this.vehicle.id,
      departureAt: new Date("2026-11-12T11:30:00.000Z"),
      arrivalAt: new Date("2026-11-12T16:00:00.000Z"),
      status: "OPEN",
      route: this.route,
      vehicle: this.vehicle
    };
  }

  travelRoute = {
    findMany: async (args?: { where?: { isActive?: boolean } }) =>
      [this.route, this.inactiveRoute].filter((route) => {
        if (typeof args?.where?.isActive === "boolean") {
          return route.isActive === args.where.isActive;
        }

        return true;
      }),
    findUnique: async ({ where }: { where: { slug?: string; id?: string } }) =>
      [this.route, this.inactiveRoute].find((route) => where.slug === route.slug || where.id === route.id) ?? null,
    findFirst: async ({ where }: { where: { slug?: string; id?: string; isActive?: boolean } }) =>
      [this.route, this.inactiveRoute].find((route) => {
        const matchesIdentity = where.slug === route.slug || where.id === route.id;
        const matchesActive = typeof where.isActive === "boolean" ? route.isActive === where.isActive : true;

        return matchesIdentity && matchesActive;
      }) ?? null
  };

  schedule = {
    findMany: async (args?: { include?: ScheduleInclude }) => [this.withScheduleRelations(args?.include)],
    findUnique: async ({ where, include }: { where: { id: string }; include?: ScheduleInclude }) =>
      where.id === this.scheduleRecord.id ? this.withScheduleRelations(include) : null
  };

  seat = {
    findFirst: async ({ where }: { where: { vehicleId: string; number: string } }) =>
      this.seats.find((seat) => seat.vehicleId === where.vehicleId && seat.number === where.number) ?? null
  };

  reservation = {
    findFirst: async ({ where }: { where: ReservationWhere }) => {
      this.assertTransactionOpen();
      return (
        this.reservations.find((reservation) => {
          if (reservation.scheduleId !== where.scheduleId) {
            return false;
          }

          if (!this.matchesStatusFilter(reservation, where.status)) {
            return false;
          }

          return where.OR?.some((condition) => {
            return (
              (condition.seatNumber && condition.seatNumber === reservation.seatNumber) ||
              (condition.seatId && condition.seatId === reservation.seatId)
            );
          });
        }) ?? null
      );
    },
    findMany: async () => {
      this.assertTransactionOpen();
      return this.reservations.map((reservation) => this.withRelations(reservation));
    },
    findUnique: async ({ where }: { where: { code: string } }) => {
      this.assertTransactionOpen();
      const reservation = this.reservations.find((item) => item.code === where.code);
      return reservation ? this.withRelations(reservation) : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<ReservationRecord> }) => {
      this.assertTransactionOpen();
      const reservation = this.reservations.find((item) => item.id === where.id);
      if (!reservation) {
        throw new Error("Missing reservation");
      }

      Object.assign(reservation, data);
      return this.withRelations(reservation);
    },
    create: async ({ data }: { data: Omit<ReservationRecord, "id" | "createdAt" | "schedule" | "passenger"> }) => {
      this.assertTransactionOpen();
      this.onBeforeReservationCreate?.();
      this.onBeforeReservationCreate = undefined;

      const passenger = this.passengers.find((item) => item.id === data.passengerId);
      if (!passenger) {
        throw new Error("Missing passenger");
      }

      if (this.reservations.some((reservation) => reservation.code === data.code)) {
        this.activeTransactionAborted = true;
        throwUniqueConstraint(["code"]);
      }

      if (
        this.reservations.some(
          (reservation) => reservation.scheduleId === data.scheduleId && reservation.seatNumber === data.seatNumber
        )
      ) {
        this.activeTransactionAborted = true;
        throwUniqueConstraint(["scheduleId", "seatNumber"]);
      }

      if (
        this.reservations.some((reservation) => reservation.scheduleId === data.scheduleId && reservation.seatId === data.seatId)
      ) {
        this.activeTransactionAborted = true;
        throwUniqueConstraint(["scheduleId", "seatId"]);
      }

      const reservation = {
        ...data,
        id: `reservation-${this.reservations.length + 1}`,
        createdAt: new Date("2026-05-11T12:00:00.000Z"),
        schedule: this.scheduleRecord,
        passenger
      };
      this.reservations.push(reservation);
      return this.withRelations(reservation);
    }
  };

  passenger = {
    create: async ({ data }: { data: CreateReservationInput["passenger"] }) => {
      this.assertTransactionOpen();
      const passenger = {
        ...data,
        id: `passenger-${this.passengers.length + 1}`
      };
      this.passengers.push(passenger);
      return passenger;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<PassengerRecord> }) => {
      this.assertTransactionOpen();
      const passenger = this.passengers.find((item) => item.id === where.id);
      if (!passenger) {
        throw new Error("Missing passenger");
      }

      Object.assign(passenger, data);
      return passenger;
    }
  };

  payment = {
    create: async ({ data }: { data: Omit<PaymentRecord, "id"> }) => {
      this.assertTransactionOpen();
      const payment = {
        ...data,
        id: `payment-${this.payments.length + 1}`
      };
      this.payments.push(payment);
      return payment;
    },
    update: async ({ where, data }: { where: { reservationId: string }; data: Partial<PaymentRecord> }) => {
      this.assertTransactionOpen();
      const payment = this.payments.find((item) => item.reservationId === where.reservationId);
      if (!payment) {
        throw new Error("Missing payment");
      }

      Object.assign(payment, data);
      return payment;
    }
  };

  ticket = {
    create: async ({ data }: { data: Omit<TicketRecord, "id"> }) => {
      this.assertTransactionOpen();
      const ticket = {
        ...data,
        id: `ticket-${this.tickets.length + 1}`
      };
      this.tickets.push(ticket);
      return ticket;
    }
  };

  async $transaction<T>(callback: (client: FakeBookingClient) => Promise<T>) {
    this.transactionCallCount += 1;
    this.activeTransactionAborted = false;

    const passengers = [...this.passengers];
    const reservations = [...this.reservations];
    const payments = [...this.payments];
    const tickets = [...this.tickets];

    try {
      return await callback(this);
    } catch (error) {
      this.passengers = passengers;
      this.reservations = reservations;
      this.payments = payments;
      this.tickets = tickets;
      throw error;
    } finally {
      this.activeTransactionAborted = false;
    }
  }

  seedReservation(overrides: Partial<ReservationRecord> = {}) {
    const passenger =
      this.passengers[0] ??
      ({
        firstName: "Seed",
        lastName: "Passenger",
        email: `seed-${this.passengers.length + 1}@example.com`,
        phone: "+5492944000001",
        documentType: "DNI",
        documentId: `seed-${this.passengers.length + 1}`,
        nationality: "AR",
        id: `passenger-${this.passengers.length + 1}`
      } satisfies PassengerRecord);
    if (!this.passengers.includes(passenger)) {
      this.passengers.push(passenger);
    }

    const reservation = {
      id: `reservation-${this.reservations.length + 1}`,
      code: `ARC-2611-SEED-${this.reservations.length + 1}`,
      scheduleId: this.scheduleRecord.id,
      passengerId: passenger.id,
      seatId: "seat-04",
      seatNumber: "04",
      status: "PENDING_PAYMENT",
      totalCents: this.route.priceCents,
      currency: this.route.currency,
      createdAt: new Date("2026-05-11T12:00:00.000Z"),
      schedule: this.scheduleRecord,
      passenger,
      ...overrides
    };

    this.reservations.push(reservation);
    return reservation;
  }

  private withRelations(reservation: ReservationRecord) {
    return {
      ...reservation,
      payment: this.payments.find((payment) => payment.reservationId === reservation.id) ?? null,
      ticket: this.tickets.find((ticket) => ticket.reservationId === reservation.id) ?? null
    };
  }

  private withScheduleRelations(include?: ScheduleInclude) {
    return {
      ...this.scheduleRecord,
      reservations: this.filterReservations(include?.reservations?.where)
    };
  }

  private filterReservations(where?: ReservationWhere) {
    return this.reservations.filter((reservation) => this.matchesStatusFilter(reservation, where?.status));
  }

  private matchesStatusFilter(reservation: ReservationRecord, status?: StatusFilter) {
    if (!status) {
      return true;
    }

    if (typeof status === "string") {
      return reservation.status === status;
    }

    if (status.not !== undefined) {
      return reservation.status !== status.not;
    }

    return true;
  }

  private assertTransactionOpen() {
    if (this.activeTransactionAborted) {
      throw new Error("current transaction is aborted, commands ignored until end of transaction block");
    }
  }
}

type StatusFilter = string | { not?: string };

type ReservationWhere = {
  scheduleId?: string;
  status?: StatusFilter;
  OR?: Array<{ seatNumber?: string; seatId?: string }>;
};

type ScheduleInclude = {
  reservations?: {
    where?: ReservationWhere;
  };
};

function throwUniqueConstraint(target: string[]): never {
  const error = new Error(`Unique constraint failed on ${target.join(", ")}`) as Error & {
    code: string;
    meta: { target: string[] };
  };
  error.code = "P2002";
  error.meta = { target };
  throw error;
}

const input: CreateReservationInput = {
  scheduleId: "schedule-1",
  passengerCount: 1,
  seatNumber: "04",
  passenger: {
    firstName: "Camila",
    lastName: "Vidal",
    email: "camila@example.com",
    phone: "+5492944000000",
    documentType: "DNI",
    documentId: "30111222",
    nationality: "AR"
  }
};

function createTestRepository(
  client: FakeBookingClient,
  code = "ARC-2611-TEST",
  deps: Partial<Parameters<typeof createBookingRepository>[1]> = {}
) {
  return createBookingRepository(client as unknown as Parameters<typeof createBookingRepository>[0], {
    createReservationCode: () => code,
    ...deps
  });
}

describe("booking repository", () => {
  it("lists only active public routes", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);

    await expect(repository.listPublicRoutes()).resolves.toMatchObject([
      {
        slug: "sma-bariloche-7-lagos"
      }
    ]);
  });

  it("does not return inactive routes by public slug", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);

    await expect(repository.getPublicRouteBySlug("sma-junin-inactiva")).resolves.toBeNull();
  });

  it("creates a pending reservation with passenger, payment, and ticket", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);

    const reservation = await repository.createWebReservation(input);

    expect(reservation).toMatchObject({
      code: "ARC-2611-TEST",
      status: "PENDING_PAYMENT",
      seatNumber: "04",
      totalCents: 1890000,
      passenger: {
        firstName: "Camila",
        email: "camila@example.com"
      },
      payment: {
        provider: "MANUAL",
        status: "PENDING",
        amountCents: 1890000
      },
      ticket: {
        code: "TKT-ARC-2611-TEST"
      }
    });
    expect(client.passengers).toHaveLength(1);
    expect(client.payments).toHaveLength(1);
    expect(client.tickets[0]?.qrPayload).toContain("ARC-2611-TEST");
  });

  it("rejects a second reservation for the same schedule and seat", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);

    await repository.createWebReservation(input);

    await expect(
      repository.createWebReservation({
        ...input,
        passenger: {
          ...input.passenger,
          email: "otra@example.com",
          documentId: "30222333"
        }
      })
    ).rejects.toMatchObject({
      code: "SEAT_OCCUPIED",
      message: "Seat 04 is already occupied"
    } satisfies Partial<BookingError>);
  });

  it("returns occupied seats for a schedule", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);

    await repository.createWebReservation(input);

    await expect(repository.getSeatMap("schedule-1")).resolves.toMatchObject({
      scheduleId: "schedule-1",
      seats: [
        { number: "04", occupied: true },
        { number: "05", occupied: false }
      ]
    });
  });

  it("marks cancelled reservations as occupied while schema uniqueness prevents reuse", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);
    client.seedReservation({ status: "CANCELLED" });

    await expect(repository.getSeatMap("schedule-1")).resolves.toMatchObject({
      seats: [
        { number: "04", occupied: true },
        { number: "05", occupied: false }
      ]
    });
  });

  it("maps seat uniqueness races at reservation create to SEAT_OCCUPIED", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);
    client.onBeforeReservationCreate = () => {
      client.seedReservation({ code: "ARC-2611-RACE" });
    };

    await expect(repository.createWebReservation(input)).rejects.toMatchObject({
      code: "SEAT_OCCUPIED",
      message: "Seat 04 is already occupied"
    } satisfies Partial<BookingError>);
  });

  it("retries reservation code collisions in separate transactions before creating payment details", async () => {
    const client = new FakeBookingClient();
    const codes = ["ARC-2611-DUPE", "ARC-2611-OK"];
    client.seedReservation({ code: "ARC-2611-DUPE", seatId: "seat-05", seatNumber: "05" });
    const paymentProvider = {
      name: "MANUAL" as const,
      createPendingPayment: vi.fn((request) => ({
        provider: "MANUAL" as const,
        status: "PENDING" as const,
        amountCents: request.amountCents,
        currency: request.currency,
        externalRef: null
      }))
    };
    const repository = createBookingRepository(client as unknown as Parameters<typeof createBookingRepository>[0], {
      createReservationCode: () => codes.shift() ?? "ARC-2611-OK",
      paymentProvider
    });

    await expect(repository.createWebReservation(input)).resolves.toMatchObject({
      code: "ARC-2611-OK",
      payment: {
        provider: "MANUAL",
        status: "PENDING"
      }
    });
    expect(paymentProvider.createPendingPayment).toHaveBeenCalledTimes(1);
    expect(paymentProvider.createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({ reservationCode: "ARC-2611-OK" })
    );
    expect(client.transactionCallCount).toBe(2);
    expect(client.passengers.filter((passenger) => passenger.email === input.passenger.email)).toHaveLength(1);
  });

  it("fails after three reservation code collisions without creating payment details", async () => {
    const client = new FakeBookingClient();
    client.seedReservation({ code: "ARC-2611-DUPE", seatId: "seat-05", seatNumber: "05" });
    const paymentProvider = {
      name: "MANUAL" as const,
      createPendingPayment: vi.fn(() => ({
        provider: "MANUAL" as const,
        status: "PENDING" as const,
        amountCents: 1890000,
        currency: "ARS",
        externalRef: null
      }))
    };
    const repository = createBookingRepository(client as unknown as Parameters<typeof createBookingRepository>[0], {
      createReservationCode: () => "ARC-2611-DUPE",
      paymentProvider
    });

    await expect(repository.createWebReservation(input)).rejects.toMatchObject({
      code: "CODE_COLLISION",
      message: "Could not generate a unique reservation code"
    } satisfies Partial<BookingError>);
    expect(client.transactionCallCount).toBe(3);
    expect(paymentProvider.createPendingPayment).not.toHaveBeenCalled();
    expect(client.passengers).toHaveLength(1);
  });

  it("does not call the payment provider when reservation create loses a seat race", async () => {
    const client = new FakeBookingClient();
    const paymentProvider = {
      name: "MANUAL" as const,
      createPendingPayment: vi.fn(() => ({
        provider: "MANUAL" as const,
        status: "PENDING" as const,
        amountCents: 1890000,
        currency: "ARS",
        externalRef: null
      }))
    };
    const repository = createTestRepository(client, "ARC-2611-TEST", { paymentProvider });
    client.onBeforeReservationCreate = () => {
      client.seedReservation({ code: "ARC-2611-RACE" });
    };

    await expect(repository.createWebReservation(input)).rejects.toMatchObject({
      code: "SEAT_OCCUPIED"
    } satisfies Partial<BookingError>);
    expect(paymentProvider.createPendingPayment).not.toHaveBeenCalled();
  });

  it("includes manual payment receipt metadata in admin reservation rows", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);
    const reservation = client.seedReservation({ code: "ARC-2611-PROOF" });
    client.payments.push({
      id: "payment-proof",
      reservationId: reservation.id,
      provider: "MANUAL",
      status: "PENDING",
      amountCents: reservation.totalCents,
      currency: reservation.currency,
      externalRef: null,
      receiptBlobUrl: "https://store.private.blob.vercel-storage.com/manual-payment-receipts/ARC-2611-PROOF.jpg",
      receiptBlobPathname: "manual-payment-receipts/ARC-2611-PROOF.jpg",
      receiptFileName: "comprobante.jpg",
      receiptContentType: "image/jpeg",
      receiptSize: 1280,
      receiptUploadedAt: new Date("2026-05-11T18:00:00.000Z")
    });

    await expect(repository.listAdminReservations()).resolves.toEqual([
      expect.objectContaining({
        code: "ARC-2611-PROOF",
        passengerPhone: "+5492944000001",
        receiptFileName: "comprobante.jpg",
        receiptUploadedAt: new Date("2026-05-11T18:00:00.000Z"),
        hasReceipt: true
      })
    ]);
  });

  it("updates passenger details for a reservation code", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);
    client.seedReservation({ code: "ARC-2611-EDIT" });

    await expect(
      repository.updatePassengerForReservation("ARC-2611-EDIT", {
        firstName: "Cami",
        lastName: "Vidal",
        email: "cami.vidal@example.com",
        phone: "+5492944556677",
        documentType: "PAS",
        documentId: "A1234567",
        nationality: "CL"
      })
    ).resolves.toMatchObject({
      code: "ARC-2611-EDIT",
      passenger: {
        firstName: "Cami",
        email: "cami.vidal@example.com",
        documentType: "PAS",
        documentId: "A1234567",
        nationality: "CL"
      }
    });
    await expect(repository.getReservationByCode("ARC-2611-EDIT")).resolves.toMatchObject({
      passenger: {
        firstName: "Cami",
        email: "cami.vidal@example.com"
      }
    });
  });

  it("rejects passenger updates for missing reservation codes", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);

    await expect(
      repository.updatePassengerForReservation("ARC-2611-MISSING", {
        firstName: "Cami",
        lastName: "Vidal",
        email: "cami.vidal@example.com",
        phone: "+5492944556677",
        documentType: "DNI",
        documentId: "30111222",
        nationality: ""
      })
    ).rejects.toMatchObject({
      code: "RESERVATION_NOT_FOUND"
    } satisfies Partial<BookingError>);
  });

  it("approves a manual payment and confirms the reservation", async () => {
    const client = new FakeBookingClient();
    const repository = createTestRepository(client);
    const reservation = client.seedReservation({ code: "ARC-2611-VALIDATE", status: "PENDING_PAYMENT" });
    client.payments.push({
      id: "payment-validate",
      reservationId: reservation.id,
      provider: "MANUAL",
      status: "PENDING",
      amountCents: reservation.totalCents,
      currency: reservation.currency,
      externalRef: null,
      receiptBlobPathname: "manual-payment-receipts/ARC-2611-VALIDATE.pdf",
      receiptFileName: "comprobante.pdf",
      receiptContentType: "application/pdf",
      receiptSize: 2048,
      receiptUploadedAt: new Date("2026-05-11T18:00:00.000Z")
    });

    await expect(repository.approveManualPayment("ARC-2611-VALIDATE")).resolves.toMatchObject({
      code: "ARC-2611-VALIDATE",
      status: "CONFIRMED",
      payment: {
        status: "APPROVED"
      }
    });
  });
});
