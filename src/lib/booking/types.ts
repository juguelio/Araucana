export const reservationStatuses = ["PENDING_PAYMENT", "CONFIRMED", "CANCELLED"] as const;
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
  bookingMode: string;
  passengerCount: number;
  status: ReservationStatus | string;
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
    flightNumber: string;
    direction: string;
    serviceDate: Date;
    pickupName?: string | null;
    pickupAddress?: string | null;
    pickupNotes?: string | null;
    flight?: { scheduledAt: Date; estimatedAt: Date | null; status: string } | null;
  } | null;
};

export type AdminScheduleRowDto = {
  id: string;
  route: string;
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
  passenger: string;
  passengerPhone: string;
  route: string;
  departureAt: Date;
  seatNumber: string | null;
  bookingMode: string;
  passengerCount: number;
  chapelcoPickupName?: string | null;
  chapelcoAscentSlot?: string | null;
  status: string;
  paymentStatus: string | null;
  hasReceipt: boolean;
  receiptFileName: string | null;
  receiptUploadedAt: Date | null;
  createdAt: Date;
};
