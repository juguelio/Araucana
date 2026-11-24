import { normalizarBusqueda } from "@/lib/booking/admin-filters";
import type { AdminScheduleRowDto } from "@/lib/booking/types";

/**
 * Servicio público: las salidas que salen de las terminales de San Martín de los Andes, Villa Traful
 * y Villa La Angostura. El módulo no inventa servicios: toma las salidas ya cargadas en Rutas y las
 * agrupa por terminal para vender y controlar desde un solo lugar.
 */
export const TERMINALES = [
  { clave: "sma", nombre: "San Martín de los Andes", corto: "SMA" },
  { clave: "traful", nombre: "Villa Traful", corto: "Traful" },
  { clave: "vla", nombre: "Villa La Angostura", corto: "VLA" }
] as const;

export type TerminalClave = (typeof TERMINALES)[number]["clave"];

const CLAVES: Record<string, TerminalClave> = {
  "san martin de los andes": "sma",
  "villa traful": "traful",
  "villa la angostura": "vla"
};

/** Terminal de la que sale la unidad, según el origen de la ruta. `null` si no es una terminal. */
export function terminalDe(from: string): TerminalClave | null {
  return CLAVES[normalizarBusqueda(from)] ?? null;
}

export function nombreDeTerminal(clave: TerminalClave): string {
  return TERMINALES.find((terminal) => terminal.clave === clave)?.nombre ?? clave;
}

export type SalidaDeTerminal = {
  id: string;
  routeId: string;
  hora: string;
  recorrido: string;
  desde: string;
  hacia: string;
  nave: string;
  vehicleId: string;
  patente: string | null;
  driverId: string | null;
  driverName: string | null;
  ocupados: number;
  capacidad: number;
  libres: number;
  /** Se puede vender sólo si la salida está abierta/en documentación y todavía no arrancó. */
  vendible: boolean;
  estado: string;
  estadoLabel: string;
};

const ESTADOS: Record<string, string> = {
  OPEN: "Programada",
  DOCUMENTATION: "En documentación",
  CLOSED: "Cerrada",
  CANCELLED: "Cancelada",
  DEPARTED: "Salió"
};

export function estadoLabel(status: string): string {
  return ESTADOS[status] ?? status;
}

const horaFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Salta"
});

/** Filas del servicio público, listas para mostrar: sólo salidas por asiento desde una terminal. */
const ESTADOS_VENDIBLES = new Set(["OPEN", "DOCUMENTATION"]);

export function ventaAbierta(status: string, departureAt: Date, now = new Date()): boolean {
  return ESTADOS_VENDIBLES.has(status) && departureAt.getTime() > now.getTime();
}

export function salidasDeTerminal(rows: AdminScheduleRowDto[], now = new Date()): SalidaDeTerminal[] {
  return rows
    .filter((row) => row.bookingMode === "SEATED" && terminalDe(row.from))
    .map((row) => {
      const ocupados = Math.max(0, row.totalSeats - row.availableSeats);
      return {
        id: row.id,
        routeId: row.routeId,
        hora: horaFormatter.format(new Date(row.departureAt)),
        recorrido: `${row.from} → ${row.to}`,
        desde: row.from,
        hacia: row.to,
        nave: row.vehicleName,
        vehicleId: row.vehicleId,
        patente: row.vehiclePlate,
        driverId: row.driverId ?? null,
        driverName: row.driverName ?? null,
        ocupados,
        capacidad: row.totalSeats,
        libres: row.availableSeats,
        vendible: ventaAbierta(row.status, new Date(row.departureAt), now),
        estado: row.status,
        estadoLabel: estadoLabel(row.status)
      };
    })
    .sort((a, b) => a.hora.localeCompare(b.hora));
}

export function agruparPorTerminal(salidas: SalidaDeTerminal[], rows: AdminScheduleRowDto[]) {
  const terminalPorSalida = new Map<string, TerminalClave>();
  rows.forEach((row) => {
    const clave = terminalDe(row.from);
    if (clave) terminalPorSalida.set(row.id, clave);
  });

  return TERMINALES.map((terminal) => ({
    ...terminal,
    salidas: salidas.filter((salida) => terminalPorSalida.get(salida.id) === terminal.clave)
  }));
}

export function resumenDeSalidas(salidas: SalidaDeTerminal[]) {
  return salidas.reduce(
    (total, salida) => ({
      salidas: total.salidas + 1,
      pasajeros: total.pasajeros + salida.ocupados,
      libres: total.libres + salida.libres
    }),
    { salidas: 0, pasajeros: 0, libres: 0 }
  );
}
