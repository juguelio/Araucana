import type { CalendarWeek } from "@/lib/admin/weekly-calendar";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { listAdminSchedules } from "@/lib/booking/repository";
import { resumenDeSalidas, salidasDeTerminal, terminalDe, TERMINALES, type TerminalClave } from "@/lib/public-service/board";
import { diasDeSemana, sumarDias } from "@/lib/school-runs/week";

export function leerTerminalSemanal(value: unknown) {
  return TERMINALES.find(({ clave }) => clave === value)?.clave;
}

export async function loadPublicServiceWeek(start: string, terminal?: TerminalClave): Promise<CalendarWeek> {
  const routes = await listAdminSchedules({ date: start, until: sumarDias(start, 6), activeRoutesOnly: true });
  const rows = salidasDeTerminal(routes);
  const visible = terminal ? rows.filter((row) => terminalDe(row.desde) === terminal) : rows;
  const dayById = new Map(routes.map((row) => [row.id, argentinaDateKey(row.departureAt)]));
  const { salidas, pasajeros, libres } = resumenDeSalidas(visible);

  return {
    summary: [
      { label: "Salidas", value: salidas }, { label: "Pasajeros anotados", value: pasajeros }, { label: "Lugares libres", value: libres }
    ],
    days: diasDeSemana(start).map((date) => {
      const query = new URLSearchParams({ vista: "dia", fecha: date });
      if (terminal) query.set("terminal", terminal);
      const href = `/admin/servicio-publico?${query}`;
      return {
        date, href,
        cards: visible.filter((row) => dayById.get(row.id) === date).map((row) => ({
          id: row.id, href, title: row.recorrido,
          kicker: `${TERMINALES.find(({ clave }) => clave === terminalDe(row.desde))?.corto ?? "—"} · ${row.hora}`,
          details: [`${row.nave} · ${row.driverName ?? "Sin chofer"}`, `${row.ocupados} de ${row.capacidad} ocupados`],
          status: {
            label: row.estadoLabel,
            tone: row.estado === "OPEN" ? "positive" : row.estado === "CANCELLED" ? "cancelled" : undefined
          }
        }))
      };
    })
  };
}
