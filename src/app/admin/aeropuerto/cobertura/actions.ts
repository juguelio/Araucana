"use server";

import { revalidatePath } from "next/cache";
import { airportCoverageSchema, saveAirportCoverage } from "@/lib/airport/pickup-zone-settings";
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
