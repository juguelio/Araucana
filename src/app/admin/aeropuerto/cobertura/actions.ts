"use server";

import { revalidatePath } from "next/cache";
import { saveAirportExtras } from "@/lib/airport/extras-settings";
import { airportCoverageSchema, saveAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { parseReservationPrice, reservationPriceError } from "@/lib/booking/admin-price";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { errorState, successState, type AdminFormState } from "../../form-state";

export async function saveCoverageAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const user = await getCurrentAdminOrRedirect();
  const raw = formData.get("coverage");
  if (typeof raw !== "string") return errorState("No se recibió el mapa.");

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return errorState("No pudimos leer el mapa.");
  }
  const parsed = airportCoverageSchema.safeParse(value);
  if (!parsed.success) return errorState("Cada sector necesita un contorno de al menos tres puntos que encierre un área.");
  await saveAirportCoverage(parsed.data, user.id);
  revalidatePath("/admin/aeropuerto/cobertura");
  revalidatePath("/admin/aeropuerto/reservar");
  revalidatePath("/reservar/[slug]", "page");
  return successState(parsed.data.enabled ? "Cobertura guardada y activa." : "Mapa guardado. La validación está desactivada.");
}

function revalidateAirport() {
  revalidatePath("/admin/aeropuerto/cobertura");
  revalidatePath("/admin/aeropuerto/reservar");
  revalidatePath("/reservar/[slug]", "page");
}

export async function saveExtrasAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const user = await getCurrentAdminOrRedirect();
  const text = (name: string) => String(formData.get(name) ?? "").trim() || "0";
  const zoneExtraCents = parseReservationPrice(text("zoneExtra"));
  const sportsLuggageCents = parseReservationPrice(text("sportsLuggage"));
  const cutoff = text("arrivalCutoff");
  const arrivalCutoffMinutes = /^\d{1,3}$/.test(cutoff) && Number(cutoff) <= 180 ? Number(cutoff) : null;

  const fieldErrors: Record<string, string> = {};
  if (zoneExtraCents === null) fieldErrors.zoneExtra = reservationPriceError;
  if (sportsLuggageCents === null) fieldErrors.sportsLuggage = reservationPriceError;
  if (arrivalCutoffMinutes === null) fieldErrors.arrivalCutoff = "Ingresá minutos enteros entre 0 y 180.";
  if (zoneExtraCents === null || sportsLuggageCents === null || arrivalCutoffMinutes === null) {
    return errorState("Revisá los campos marcados.", fieldErrors);
  }

  await saveAirportExtras({ zoneExtraCents, sportsLuggageCents, arrivalCutoffMinutes }, user.id);
  revalidateAirport();
  return successState("Extras guardados.");
}
