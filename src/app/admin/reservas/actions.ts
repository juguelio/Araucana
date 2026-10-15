"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { approveManualPayment, BookingError, createWebReservation, updatePassengerForReservation } from "@/lib/booking/repository";
import { createReservationSchema, passengerSchema } from "@/lib/booking/validation";
import {
  errorState,
  fieldErrorsFromZodError,
  successState,
  type AdminFormState
} from "../form-state";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

export async function createAdminReservationAction(formData: FormData) {
  await getCurrentReservationsUserOrRedirect();

  const parsed = createReservationSchema.safeParse({
    scheduleId: value(formData, "scheduleId"),
    passengerCount: value(formData, "passengerCount"),
    passenger: {
      firstName: value(formData, "firstName"),
      lastName: value(formData, "lastName"),
      email: value(formData, "email"),
      phone: value(formData, "phone"),
      documentType: value(formData, "documentType"),
      documentId: value(formData, "documentId"),
      nationality: value(formData, "nationality") || null
    }
  });

  if (!parsed.success) {
    redirect(`/admin/reservas/nueva?notice=${encodeURIComponent("Revisa los datos de la reserva.")}`);
  }

  let reservation: Awaited<ReturnType<typeof createWebReservation>>;
  try {
    reservation = await createWebReservation(parsed.data);
  } catch (error) {
    const message = error instanceof BookingError && error.code === "CAPACITY_FULL"
      ? "No hay suficientes asientos disponibles para esa salida."
      : error instanceof BookingError && error.code === "BOOKING_BUSY"
        ? "La salida está recibiendo otras reservas en este momento. Intentalo nuevamente."
        : "No pudimos crear la reserva. Intentalo nuevamente.";
    redirect(`/admin/reservas/nueva?notice=${encodeURIComponent(message)}`);
  }

  revalidatePath("/admin/reservas");
  revalidatePath(`/admin/reservas/${reservation.code}`);
  revalidatePath(`/reservar/${reservation.route.slug}`);
  redirect(`/admin/reservas/${reservation.code}`);
}

export async function approveManualPaymentAction(formData: FormData) {
  await getCurrentReservationsUserOrRedirect();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();

  if (!code) {
    redirect(`/admin/reservas?notice=${encodeURIComponent("No pudimos validar el pago porque falta el codigo de reserva.")}`);
  }

  try {
    await approveManualPayment(code);
    revalidatePath("/admin/reservas");
    revalidatePath(`/reservas/${code}`);
    redirect(`/admin/reservas?notice=${encodeURIComponent("Pago validado con exito.")}`);
  } catch (error) {
    if (error instanceof BookingError && error.code === "RECEIPT_NOT_FOUND") {
      redirect(`/admin/reservas?notice=${encodeURIComponent("No encontramos el comprobante para validar ese pago.")}`);
    }

    throw error;
  }
}

export async function updatePassengerAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await getCurrentReservationsUserOrRedirect();
  const code = value(formData, "code").toUpperCase();

  if (!code) {
    return errorState("Falta el codigo de reserva. Volve a abrirla desde el listado.");
  }

  const parsed = passengerSchema.safeParse({
    firstName: value(formData, "firstName"),
    lastName: value(formData, "lastName"),
    email: value(formData, "email"),
    phone: value(formData, "phone"),
    documentType: value(formData, "documentType"),
    documentId: value(formData, "documentId"),
    nationality: value(formData, "nationality") || null
  });

  if (!parsed.success) {
    return errorState("Revisa los campos marcados para guardar el pasajero.", fieldErrorsFromZodError(parsed.error));
  }

  try {
    await updatePassengerForReservation(code, parsed.data);
  } catch (error) {
    if (error instanceof BookingError && error.code === "RESERVATION_NOT_FOUND") {
      return errorState("La reserva ya no existe. Volve al listado y buscala nuevamente.");
    }

    return errorState("No pudimos guardar el pasajero. Intentalo nuevamente.");
  }

  revalidatePath("/admin/reservas");
  revalidatePath(`/admin/reservas/${code}`);
  revalidatePath(`/reservas/${code}`);
  return successState("Pasajero guardado con exito.");
}
