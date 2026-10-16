"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { detectFlightChange } from "@/lib/airport/flights";
import { syncAirportFlights } from "@/lib/airport/sync";
import { getCurrentAdminOrRedirect, getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { AIRLABS_KEY_SETTING, setSetting } from "@/lib/settings/app-settings";
import { errorState, type AdminFieldErrors, type AdminFormState } from "../form-state";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function notice(text: string): never {
  redirect(`/admin/aeropuerto?notice=${encodeURIComponent(text)}`);
}

export async function createFlightAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await getCurrentReservationsUserOrRedirect();

  const number = value(formData, "number").toUpperCase();
  const airline = value(formData, "airline") || null;
  const origin = value(formData, "origin");
  const direction = value(formData, "direction") === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL";
  const scheduledAt = value(formData, "scheduledAt");
  const passengers = value(formData, "passengers");
  const notes = value(formData, "notes") || null;

  const fieldErrors: AdminFieldErrors = {};
  if (!number) fieldErrors.number = "Ingresá el número de vuelo (ej. AR 1656).";
  if (!origin) fieldErrors.origin = "Ingresá el origen o destino.";
  if (!scheduledAt) fieldErrors.scheduledAt = "Ingresá la fecha y hora programada.";
  if (Object.keys(fieldErrors).length > 0) return errorState("Revisá los datos del vuelo.", fieldErrors);

  await prisma.flight.create({
    data: {
      number,
      airline,
      origin,
      direction,
      scheduledAt: new Date(scheduledAt),
      passengers: passengers ? Number(passengers) : null,
      notes,
      source: "MANUAL"
    }
  });

  revalidatePath("/admin/aeropuerto");
  notice(`Vuelo ${number} cargado.`);
}

/**
 * Cambia el estado o la hora estimada. Si el cambio es un imprevisto (demora, cancelación,
 * desvío, adelanto), queda registrado como FlightEvent: eso es lo que después avisa.
 */
export async function updateFlightAction(formData: FormData) {
  await getCurrentReservationsUserOrRedirect();

  const id = value(formData, "id");
  const status = value(formData, "status");
  const estimatedAt = value(formData, "estimatedAt");

  const prev = await prisma.flight.findUnique({ where: { id } });
  if (!prev) notice("El vuelo ya no existe.");

  const next = {
    status: status || prev.status,
    scheduledAt: prev.scheduledAt,
    estimatedAt: estimatedAt ? new Date(estimatedAt) : prev.estimatedAt
  };

  const cambio = detectFlightChange(
    { status: prev.status, scheduledAt: prev.scheduledAt, estimatedAt: prev.estimatedAt },
    next
  );

  await prisma.flight.update({
    where: { id },
    data: {
      status: next.status,
      estimatedAt: next.estimatedAt,
      actualAt: next.status === "LANDED" ? new Date() : prev.actualAt,
      ...(cambio
        ? { events: { create: { kind: cambio.kind, fromValue: cambio.fromValue, toValue: cambio.toValue } } }
        : {})
    }
  });

  revalidatePath("/admin/aeropuerto");
  notice(cambio ? `Cambio registrado: ${cambio.kind} (${next.status}).` : "Vuelo actualizado.");
}

/** Asigna una combi a un vuelo. Se puede cambiar hasta último momento: agregar, cambiar o quitar. */
export async function assignVehicleAction(formData: FormData) {
  await getCurrentReservationsUserOrRedirect();

  const flightId = value(formData, "flightId");
  const vehicleId = value(formData, "vehicleId");
  const driverId = value(formData, "driverId") || null;

  if (!flightId || !vehicleId) notice("Elegí una combi para asignar.");

  await prisma.airportVehicleAssignment.upsert({
    where: { flightId_vehicleId: { flightId, vehicleId } },
    update: { driverId },
    create: { flightId, vehicleId, driverId }
  });

  revalidatePath("/admin/aeropuerto");
  notice("Combi asignada al vuelo.");
}

export async function removeAssignmentAction(formData: FormData) {
  await getCurrentReservationsUserOrRedirect();
  await prisma.airportVehicleAssignment.delete({ where: { id: value(formData, "id") } });
  revalidatePath("/admin/aeropuerto");
  notice("Combi quitada del vuelo.");
}

export async function deleteFlightAction(formData: FormData) {
  await getCurrentReservationsUserOrRedirect();
  await prisma.flight.delete({ where: { id: value(formData, "id") } });
  revalidatePath("/admin/aeropuerto");
  notice("Vuelo borrado.");
}

/**
 * Modo degradado: si todavía no hay proveedor de datos en vivo, el botón no rompe nada
 * y lo dice. Una combi no puede depender de un servicio externo.
 */
export async function refreshFlightsAction() {
  await getCurrentReservationsUserOrRedirect();
  const r = await syncAirportFlights();
  revalidatePath("/admin/aeropuerto");
  if (r.errores.length > 0) {
    notice(`No se pudo traer los vuelos (${r.errores[0]}). Se sigue con lo cargado a mano.`);
  }
  notice(
    `Vuelos actualizados: ${r.creados} nuevos, ${r.actualizados} revisados (${r.desdeTablero} desde el tablero del aeropuerto), ${r.eventos} imprevisto(s).`
  );
}

/**
 * Guarda la clave de AirLabs desde el panel y la prueba en el momento. Antes vivía sólo en una
 * variable de entorno del hosting: así se puede resolver sin depender de nadie más. Sólo ADMIN.
 */
export async function saveAirLabsKeyAction(formData: FormData) {
  const usuario = await getCurrentAdminOrRedirect();
  const borrar = value(formData, "borrar");
  const apiKey = value(formData, "apiKey");

  if (borrar) {
    await setSetting(AIRLABS_KEY_SETTING, null, usuario.email);
    revalidatePath("/admin/aeropuerto");
    notice("Clave borrada: los vuelos se siguen viendo, pero ya no se actualizan solos.");
  }

  if (apiKey.length < 8) {
    notice("Esa clave no parece válida (es muy corta). No se guardó nada.");
  }

  await setSetting(AIRLABS_KEY_SETTING, apiKey, usuario.email);
  const r = await syncAirportFlights();
  revalidatePath("/admin/aeropuerto");

  if (r.errores.length > 0) {
    notice(`La clave se guardó, pero AirLabs no respondió: ${r.errores[0]}`);
  }

  notice(
    `Clave guardada y probada: ${r.creados} vuelos nuevos, ${r.actualizados} revisados, ${r.proyectados} proyectados.`
  );
}
