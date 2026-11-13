export const reservationStatuses = ["PENDING_PAYMENT", "DOCUMENTATION_PENDING", "CONFIRMED", "CANCELLED"] as const;
export const scheduleStatuses = ["OPEN", "DOCUMENTATION", "CLOSED"] as const;

export type ReservationStatus = (typeof reservationStatuses)[number];
export type ScheduleStatus = (typeof scheduleStatuses)[number];

export type PublicRouteDto = {
  id: string;
  slug: string;
  from: string;
  to: string;
  via: string;
  description: string;
  category: string;
  featured: boolean;
  durationMin: number;
  priceCents: number;
  price: number;
  currency: string;
  bookingMode: string;
  specialType?: string | null;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
  stops?: unknown;
};

export type AdminRouteRowDto = PublicRouteDto & {
  isActive: boolean;
  scheduleCount: number;
};

export type ScheduleOptionDto = {
  id: string;
  route: PublicRouteDto;
  departureAt: Date;
  arrivalAt: Date;
  status: ScheduleStatus | string;
  availableSeats: number;
  totalSeats: number;
  priceCents: number;
  price: number;
  currency: string;
};

/**
 * Lo que el formulario de reserva necesita de cada salida. La ruta ya está en la página:
 * repetirla en cada una de las cientos de salidas era la mayor parte del HTML de /reservar.
 */
export type CheckoutScheduleDto = Omit<ScheduleOptionDto, "route">;

export type SeatOptionDto = {
  id: string;
  number: string;
  row: number;
  column: number;
  occupied: boolean;
};

export type SeatMapDto = {
  scheduleId: string;
  vehicleId: string;
  seats: SeatOptionDto[];
};

export type PassengerDto = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  documentType: string;
  documentId: string;
  nationality?: string | null;
};

export type PaymentDto = {
  provider: string;
  status: string;
  amountCents: number;
  amount: number;
  currency: string;
  method?: string | null;
  externalRef?: string | null;
  receiptBlobUrl?: string | null;
  receiptBlobPathname?: string | null;
  receiptFileName?: string | null;
  receiptContentType?: string | null;
  receiptSize?: number | null;
  receiptUploadedAt?: Date | null;
};

export type TicketDto = {
  code: string;
  qrPayload: string;
};

export type ReservationDetailDto = {
  id: string;
  code: string;
  /** Ida y vuelta del aeropuerto (#36): id del viaje que comparten los dos tramos. */
  roundTripId?: string | null;
  /** El otro tramo del ida y vuelta (sólo en las consultas del panel). */
  roundTripPartner?: { code: string; shortCode: string; direction: string | null } | null;
  /** Código corto para dictar y buscar en el panel. Nunca abre la reserva: eso lo hace `code`. */
  shortCode: string;
  bookingMode: string;
  dropoffStop?: string | null;
  passengerCount: number;
  halfFareCount?: number;
  freeFareCount?: number;
  status: ReservationStatus | string;
  /** Cancelación con motivo (#108): lo que escribió quien canceló, cuándo y quién fue. */
  cancellationReason?: string | null;
  cancelledAt?: Date | null;
  cancelledByName?: string | null;
  seatNumber: string | null;
  totalCents: number;
  total: number;
  currency: string;
  createdAt: Date;
  route: PublicRouteDto;
  schedule: Omit<ScheduleOptionDto, "availableSeats" | "totalSeats">;
  passenger: PassengerDto;
  payment: PaymentDto | null;
  ticket: TicketDto | null;
  chapelcoDetails?: {
    serviceDate: Date;
    ascentSlot: string;
    pickupName: string;
    pickupAddress: string;
    pickupLatitude: number;
    pickupLongitude: number;
    pickupNotes?: string | null;
  } | null;
  airportDetails?: {
    halfFareCount?: number;
    sportsLuggageCount?: number;
    sportsLuggageUnitCents?: number;
    zoneExtraCents?: number;
    flightNumber: string;
    direction: string;
    serviceDate: Date;
    pickupName?: string | null;
    pickupAddress?: string | null;
    pickupLatitude?: number | null;
    pickupLongitude?: number | null;
    pickupNotes?: string | null;
    flight?: { scheduledAt: Date; estimatedAt: Date | null; status: string; pickupStartOverrideAt?: Date | null } | null;
  } | null;
};

export type AdminScheduleRowDto = {
  id: string;
  stopFares?: import("./stop-fares").StopFare[];
  bookingMode?: string;
  priceCents?: number;
  currency?: string;
  route: string;
  from: string;
  to: string;
  routeId: string;
  vehicleId: string;
  departureAt: Date;
  arrivalAt: Date;
  status: string;
  availableSeats: number;
  totalSeats: number;
};

export type AdminReservationRowDto = {
  id: string;
  code: string;
  shortCode: string;
  passenger: string;
  passengerPhone: string;
  creatorLabel: string;
  route: string;
  departureAt: Date;
  travelDay: string | null;
  seatNumber: string | null;
  bookingMode: string;
  passengerCount: number;
  chapelcoPickupName?: string | null;
  chapelcoAscentSlot?: string | null;
  flightNumber: string | null;
  status: string;
  paymentStatus: string | null;
  paymentProvider?: string | null;
  hasReceipt: boolean;
  receiptFileName: string | null;
  receiptUploadedAt: Date | null;
  createdAt: Date;
};

/** Una página del listado de reservas del panel: `total` es el de la búsqueda, sin paginar. */
export type AdminReservationsPageDto = {
  items: AdminReservationRowDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
