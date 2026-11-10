import { z } from "zod";

export const statuses = { PENDING: "Pendiente", CONFIRMED: "Confirmado", COMPLETED: "Realizado", CANCELLED: "Cancelado" };
export const billingModes = { FIXED: "Importe acordado", ACCOUNT: "Cuenta corriente", UNKNOWN: "Importe por confirmar", INCLUDED: "Incluido en otro servicio" };
export const argentina = "America/Argentina/Salta";
export const timezones = [argentina, "America/Santiago", "America/Coyhaique", "America/Punta_Arenas"] as const;

export function localInput(value: Date, timeZone = argentina) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(value).replace(" ", "T");
}

export function dateOnly(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const result = new Date(raw + "T00:00:00Z");
  return Number.isFinite(+result) && result.toISOString().startsWith(raw) ? result : null;
}

export function localDateTime(raw: string, zone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) || !dateOnly(raw.slice(0, 10))) return null;
  const reference = +new Date(raw + ":00Z");
  if (!Number.isFinite(reference)) return null;
  // Test both offsets around a DST transition, then round-trip the entered wall time.
  const offsets = new Set([-1, 0, 1].map((day) => {
    const sample = reference + day * 86_400_000;
    return +new Date(localInput(new Date(sample), zone) + ":00Z") - sample;
  }));
  const matches = [...offsets].map((offset) => new Date(reference - offset))
    .filter((candidate) => localInput(candidate, zone) === raw);
  return matches.length === 1 ? matches[0] : null;
}

export function parseMoney(raw: string, max = 2_147_483_647) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) return null;
  const [whole, decimal = ""] = raw.split(/[.,]/);
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= max ? cents : null;
}

const line = z.string().trim().max(500);
export const legSchema = z.object({
  origin: line, destination: line, country: z.enum(["AR", "CL", "AR_CL"]), stops: line,
  zone: z.enum(timezones), arrivalZone: z.enum(timezones).optional(), departure: line, arrival: line, included: z.boolean(), description: z.string().max(4000)
});
export const assignmentSchema = z.object({ vehicleId: line.min(1), driverId: line, start: line, end: line });
export const paymentSchema = z.object({ date: line, amount: line, note: line });
export type Leg = z.infer<typeof legSchema>;
export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export const emptyLeg: Leg = {
  origin: "", destination: "", country: "AR", stops: "", zone: argentina,
  departure: "", arrival: "", included: false, description: ""
};
