"use server";

import { revalidatePath } from "next/cache";
import { saveAirportExtras } from "@/lib/airport/extras-settings";
import { airportCoverageSchema, saveAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { airportOfficePickupSchema, saveAirportOfficePickup } from "@/lib/airport/office-pickup";
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
  const cutoffSalida = text("departureCutoff");
  const departureCutoffMinutes = /^\d{1,3}$/.test(cutoffSalida) && Number(cutoffSalida) <= 180 ? Number(cutoffSalida) : null;

  const fieldErrors: Record<string, string> = {};
  if (zoneExtraCents === null) fieldErrors.zoneExtra = reservationPriceError;
  if (sportsLuggageCents === null) fieldErrors.sportsLuggage = reservationPriceError;
  if (arrivalCutoffMinutes === null) fieldErrors.arrivalCutoff = "Ingresá minutos enteros entre 0 y 180.";
  if (departureCutoffMinutes === null) fieldErrors.departureCutoff = "Ingresá minutos enteros entre 0 y 180.";
  if (zoneExtraCents === null || sportsLuggageCents === null || arrivalCutoffMinutes === null || departureCutoffMinutes === null) {
    return errorState("Revisá los campos marcados.", fieldErrors);
  }

  await saveAirportExtras({ zoneExtraCents, sportsLuggageCents, arrivalCutoffMinutes, departureCutoffMinutes }, user.id);
  revalidateAirport();
  return successState("Extras guardados.");
}

/** Atajo «salir desde la sucursal» (#34): dirección + punto de la oficina. */
export async function saveOfficePickupAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const user = await getCurrentAdminOrRedirect();
  const enabled = formData.get("enabled") === "on";
  const label = String(formData.get("label") ?? "");
  const address = String(formData.get("address") ?? "");
  const coordenada = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim().replace(",", ".");
    if (!raw) return null;
    const valor = Number(raw);
    return Number.isFinite(valor) ? valor : null;
  };
  const lat = coordenada("lat");
  const lng = coordenada("lng");
  // Sin las dos coordenadas no hay punto: el atajo no puede quedar a medias.
  const point = lat === null || lng === null ? null : ([lat, lng] as [number, number]);

  const parsed = airportOfficePickupSchema.safeParse({ enabled, label, address, point });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const campo = issue.path[0];
      if (campo === "lat" || campo === "lng" || campo === "point") fieldErrors.point ??= "Ingresá latitud y longitud del punto de la oficina.";
      else if (campo === "label" || campo === "address") fieldErrors[String(campo)] = issue.message;
    }
    if (enabled && !point) fieldErrors.point ??= "Con el atajo activo hace falta el punto de la oficina (latitud y longitud).";
    return errorState("Revisá los campos marcados.", fieldErrors);
  }
  if (parsed.data.enabled && !parsed.data.point) {
    return errorState("Revisá los campos marcados.", { point: "Con el atajo activo hace falta el punto de la oficina (latitud y longitud)." });
  }

  await saveAirportOfficePickup(parsed.data, user.id);
  revalidateAirport();
  return successState(parsed.data.enabled ? "Atajo activo en el checkout." : "Atajo guardado y desactivado.");
}
