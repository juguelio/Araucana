const DIA_MS = 86_400_000;

/** Una fecha ISO `AAAA-MM-DD` a medianoche UTC, como se guardan las fechas de servicio. */
export function fechaUTC(iso: string) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : date;
}

export function sumarDias(iso: string, dias: number) {
  const date = fechaUTC(iso);
  if (!date) return iso;
  return new Date(date.getTime() + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Lunes de la semana que contiene la fecha. */
export function lunesDe(iso: string) {
  const date = fechaUTC(iso);
  if (!date) return iso;
  const dia = date.getUTCDay(); // 0 = domingo
  return sumarDias(iso, -((dia + 6) % 7));
}

export function diasDeSemana(lunes: string) {
  return Array.from({ length: 7 }, (_, index) => sumarDias(lunes, index));
}

/** Valida una fecha o devuelve null para que el llamador use la semana actual. */
export function leerSemana(value: unknown) {
  const iso = String(value ?? "").trim();
  return fechaUTC(iso) ? iso : null;
}

export function etiquetaDeSemana(lunes: string) {
  const start = fechaUTC(lunes);
  if (!start) return lunes;
  const end = fechaUTC(sumarDias(lunes, 6))!;
  const formato = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${formato.format(start)} al ${formato.format(end)}`;
}
