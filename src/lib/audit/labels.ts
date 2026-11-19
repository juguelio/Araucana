import { ACCOUNTING_CATEGORY_LABELS, type AccountingCategory } from "@/lib/accounting/types";
import { formatCurrency } from "@/lib/admin/salary";
import type { AuditChanges } from "./diff";
import type { AuditAction, AuditEntity } from "./record";

/** Cómo se lee la auditoría en pantalla. En la base quedan los códigos; acá se traducen. */

export const auditActionLabels: Record<AuditAction, string> = {
  LOGIN: "Inicio de sesión",
  LOGIN_FAILED: "Inicio de sesión fallido",
  LOGOUT: "Cierre de sesión",
  REGISTER: "Registro",
  CREATE: "Alta",
  UPDATE: "Edición",
  DELETE: "Borrado",
  IMPORT: "Importación",
  EXPORT: "Descarga",
  VIEW: "Consulta",
  CANCEL: "Cancelación",
  RESTORE: "Restitución",
  CONFIRM: "Confirmación",
  PAYMENT_REGISTERED: "Pago registrado",
  PAYMENT_APPROVED: "Pago validado",
  PAYMENT_REJECTED: "Pago rechazado",
  DOCUMENT_APPROVED: "Documentación aprobada",
  DOCUMENT_REJECTED: "Documentación rechazada"
};

export const auditEntityLabels: Record<AuditEntity, string> = {
  SESSION: "Accesos",
  RESERVATION: "Reservas y pagos",
  ACCOUNTING_ENTRY: "Contabilidad",
  USER: "Usuarios",
  ROUTE: "Rutas",
  VEHICLE: "Naves",
  SCHEDULE: "Salidas",
  EXCURSION: "Excursiones",
  DEPARTURE_SHEET: "Planillas",
  SPECIAL_TRIP: "Viajes especiales",
  AIRPORT: "Aeropuerto",
  CHAPELCO: "Chapelco"
};

const roleLabels: Record<string, string> = {
  SUPERADMIN: "Super administrador",
  ADMIN: "Administrador",
  SECRETARY: "Secretaría",
  DRIVER: "Chofer",
  USER: "Usuario",
  GUEST: "Sin sesión",
  SYSTEM: "Sistema"
};

export function auditRoleLabel(role: string) {
  return roleLabels[role] ?? role;
}

const fieldLabels: Record<string, string> = {
  status: "Estado",
  totalCents: "Total",
  amountCents: "Importe",
  currency: "Moneda",
  passengerCount: "Pasajeros",
  seatNumber: "Asiento",
  dropoffStop: "Parada de descenso",
  referredBy: "Derivado por",
  cancellationReason: "Motivo de cancelación",
  cancelledByName: "Cancelada por",
  restoredByName: "Restituida por",
  "payment.provider": "Pago · medio de cobro",
  "payment.status": "Pago · estado",
  "payment.amountCents": "Pago · importe",
  "payment.method": "Pago · forma de pago",
  "payment.externalRef": "Pago · referencia",
  "payment.receiptFileName": "Pago · comprobante",
  "passenger.firstName": "Pasajero · nombre",
  "passenger.lastName": "Pasajero · apellido",
  "passenger.email": "Pasajero · email",
  "passenger.phone": "Pasajero · teléfono",
  "passenger.documentType": "Pasajero · tipo de documento",
  "passenger.documentId": "Pasajero · documento",
  "passenger.nationality": "Pasajero · nacionalidad",
  "pickup.pickupName": "Traslado · nombre",
  "pickup.pickupAddress": "Traslado · dirección",
  "pickup.pickupLatitude": "Traslado · latitud",
  "pickup.pickupLongitude": "Traslado · longitud",
  "pickup.pickupNotes": "Traslado · notas",
  "airport.sportsLuggageCount": "Equipaje deportivo (bultos)",
  email: "Email",
  name: "Nombre",
  role: "Rol",
  isActive: "Cuenta activa",
  monthlySalaryCents: "Sueldo mensual",
  password: "Contraseña",
  category: "Categoría",
  occurredAt: "Fecha del movimiento",
  vehicleId: "Nave",
  userId: "Persona",
  salaryPeriod: "Período del sueldo",
  notes: "Notas",
  slug: "Dirección pública",
  from: "Origen",
  to: "Destino",
  via: "Vía",
  durationMin: "Duración (min)",
  priceCents: "Precio",
  description: "Descripción",
  featured: "Destacada",
  stops: "Paradas",
  bookingMode: "Modo de reserva",
  serviceStartDate: "Inicio de temporada",
  serviceEndDate: "Fin de temporada",
  plate: "Patente",
  model: "Modelo",
  capacity: "Capacidad",
  seats: "Asientos",
  internalNumber: "Número interno",
  owner: "Titular",
  year: "Año",
  acquiredAt: "Fecha de compra",
  technicalInspectionDueAt: "Vencimiento VTV",
  rtoDueAt: "Vencimiento RTO",
  insurer: "Aseguradora",
  policyDueAt: "Vencimiento de póliza",
  publicTransport: "Transporte público",
  kind: "Tipo",
  departureAt: "Salida",
  arrivalAt: "Llegada",
  vehicle: "Nave",
  driver: "Chofer",
  routeId: "Ruta",
  isPublished: "Publicada",
  duration: "Duración",
  photos: "Fotos",
  isOpen: "Abierta",
  firstName: "Nombre",
  lastName: "Apellido",
  documentType: "Tipo de documento",
  documentNumber: "Documento",
  nationality: "Nacionalidad",
  serviceDate: "Fecha del servicio",
  client: "Cliente",
  contact: "Contacto",
  passengers: "Pasajeros",
  legs: "Tramos",
  payments: "Cobros",
  billingMode: "Condición de cobro",
  supplier: "Proveedor",
  invoice: "Factura",
  invoiceDate: "Fecha de factura",
  paymentStatus: "Estado de cobro",
  destinationSearch: "Destinos",
  assignments: "Ocupaciones de flota",
  number: "Vuelo",
  airline: "Aerolínea",
  origin: "Origen o destino",
  direction: "Sentido",
  scheduledAt: "Hora programada",
  estimatedAt: "Hora estimada",
  actualAt: "Hora real",
  pickupStartOverrideAt: "Inicio de recorrida",
  enabled: "Activo",
  label: "Nombre",
  address: "Dirección",
  pickupLatitude: "Latitud",
  pickupLongitude: "Longitud",
  coverage: "Mapa",
  zoneExtraCents: "Recargo por zona",
  sportsLuggageCents: "Equipaje deportivo",
  arrivalCutoffMinutes: "Cierre de llegadas (min)",
  departureCutoffMinutes: "Cierre de partidas (min)",
  stopStatus: "Estado de la parada",
  closedSchedules: "Salidas cerradas",
  stopOrder: "Posición de la parada",
  sex: "Sexo",
  birthDate: "Fecha de nacimiento",
  occupation: "Ocupación",
  residenceCountry: "País de residencia",
  source: "Origen del dato",
  licensePlate: "Patente",
  brand: "Marca",
  templateKey: "Plantilla de asientos",
  extraUnits: "Otras naves de la salida",
  "driver.documentNumber": "Chofer · DNI",
  "driver.cuil": "Chofer · CUIL",
  "driver.licenseCategory": "Chofer · categoría de licencia",
  "driver.licenseScope": "Chofer · alcance de la licencia",
  "driver.licenseExpiresAt": "Chofer · vencimiento de licencia",
  "driver.criminalRecordExpiresAt": "Chofer · vencimiento de antecedentes"
};

const valueLabels: Record<string, string> = {
  PENDING_PAYMENT: "Pago pendiente",
  DOCUMENTATION_PENDING: "Documentación pendiente",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  ...roleLabels
};

export function auditFieldLabel(field: string) {
  return fieldLabels[field] ?? field;
}

const dateTime = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  timeZone: "America/Argentina/Salta"
});

export function formatAuditDate(date: Date) {
  return dateTime.format(date);
}

export function formatAuditValue(field: string, value: unknown, currency = "ARS") {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number" && /Cents$/.test(field)) return formatCurrency(value, currency);
  if (typeof value === "string") {
    // La fecha de un movimiento contable es un día, no un instante: se muestra sin hora ni huso.
    // Un día sin hora (fecha de un movimiento, de un servicio, de una factura, de una temporada) se
    // guarda como medianoche UTC: se muestra como día, sin correrlo al huso argentino.
    if ((field === "occurredAt" && /^\d{4}-\d{2}-\d{2}/.test(value)) || /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value)) {
      return value.slice(0, 10).split("-").reverse().join("/");
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return dateTime.format(new Date(value));
    if (field === "category") return ACCOUNTING_CATEGORY_LABELS[value as AccountingCategory] ?? value;
    return valueLabels[value] ?? value;
  }
  if (typeof value !== "object") return String(value);
  // Listas guardadas como JSON (paradas, tramos, cobros): se muestran, pero recortadas para no tapar la tabla.
  const text = JSON.stringify(value);
  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

export type AuditChangeLine = { field: string; label: string; before: string; after: string };

/** Los cambios guardados, listos para mostrar: una línea por campo con antes y después. */
export function auditChangeLines(changes: unknown): AuditChangeLine[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  const entries = Object.entries(changes as AuditChanges);
  const currencyChange = (changes as AuditChanges).currency;
  const currency = typeof currencyChange?.after === "string" ? currencyChange.after
    : typeof currencyChange?.before === "string" ? currencyChange.before : "ARS";
  return entries
    .filter(([, change]) => change && typeof change === "object" && "before" in change && "after" in change)
    .map(([field, change]) => ({
      field,
      label: auditFieldLabel(field),
      before: formatAuditValue(field, change.before, currency),
      after: formatAuditValue(field, change.after, currency)
    }));
}
