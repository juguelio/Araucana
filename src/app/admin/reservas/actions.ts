"use server";

import { del } from "@vercel/blob";
import { manageReservation, reservationManagementSchema } from "@/lib/booking/admin-management";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAdminOrRedirect, getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { reviewDisabilityDocument, approveManualPayment, rejectManualPayment, BookingError, createWebReservation, updatePassengerForReservation } from "@/lib/booking/repository";
import { adminReservationSchema, adminPassengerSchema } from "@/lib/booking/validation";
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

  const parsed = adminReservationSchema.safeParse({
    scheduleId: value(formData, "scheduleId"),
    requestDisabilityFare: formData.get("requestDisabilityFare") === "on",
    dropoffStop: value(formData, "dropoffStop") || undefined,
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
    redirect(`/admin/reservas/nueva?notice=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Revisá los datos de la reserva.")}`);
  }

  let reservation: Awaited<ReturnType<typeof createWebReservation>>;
  try {
    reservation = await createWebReservation(parsed.data, true);
  } catch (error) {
    const message = error instanceof BookingError && error.code === "CAPACITY_FULL"
      ? "No hay suficientes asientos disponibles para esa salida."
      : error instanceof BookingError && error.code === "BOOKING_BUSY"
        ? "La salida está recibiendo otras reservas en este momento. Intentalo nuevamente."
        : error instanceof BookingError && error.code === "DISABILITY_FARE_NOT_AVAILABLE"
        ? error.message
        : error instanceof BookingError && error.code === "STOP_NOT_AVAILABLE"
        ? "La parada seleccionada ya no está disponible. Volvé a elegir."
        : "No pudimos crear la reserva. Intentalo nuevamente.";
    redirect(`/admin/reservas/nueva?notice=${encodeURIComponent(message)}`);
  }

  revalidatePath("/admin/reservas");
  revalidatePath(`/admin/reservas/${reservation.code}`);
  revalidatePath(`/reservar/${reservation.route.slug}`);
  redirect(`/admin/reservas/${reservation.code}`);
}

async function reviewPaymentAction(formData: FormData, decision: "approve" | "reject") {
  await getCurrentReservationsUserOrRedirect();
  const code = value(formData, "code").toUpperCase();
  if (!code) redirect(`/admin/reservas?notice=${encodeURIComponent("Falta el código de reserva.")}`);
  try {
    await (decision === "approve" ? approveManualPayment(code) : rejectManualPayment(code));
  } catch (error) {
    if (error instanceof BookingError) {
      redirect(`/admin/reservas?notice=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
  revalidatePath("/admin/reservas");
  revalidatePath(`/admin/reservas/${code}`);
  revalidatePath(`/reservas/${code}`);
  revalidatePath("/admin/contabilidad");
  revalidatePath("/admin/reportes");
  redirect(`/admin/reservas?notice=${encodeURIComponent(decision === "approve" ? "Pago validado con éxito." : "Comprobante rechazado. El pasajero puede enviar uno nuevo.")}`);
}

async function reviewDisabilityDocumentAction(formData: FormData, decision: "APPROVED" | "REJECTED") {
  await getCurrentAdminOrRedirect();
  const code = value(formData, "code");
  try {
    await reviewDisabilityDocument(code, decision, value(formData, "receiptVersion"));
  } catch (error) {
    if (error instanceof BookingError) redirect(`/admin/reservas?notice=${encodeURIComponent(error.message)}`);
    throw error;
  }

  revalidatePath("/admin/reservas");
  revalidatePath(`/admin/reservas/${code}`);
  revalidatePath(`/reservas/${code}`);
  const message = decision === "APPROVED" ? "Documentación aprobada. Reserva sin cargo confirmada." : "Documentación rechazada. El pasajero puede subir un comprobante nuevo.";
  redirect(`/admin/reservas?notice=${encodeURIComponent(message)}`);
}

export async function approveDisabilityDocumentAction(formData: FormData) {
  return reviewDisabilityDocumentAction(formData, "APPROVED");
}

export async function rejectDisabilityDocumentAction(formData: FormData) {
  return reviewDisabilityDocumentAction(formData, "REJECTED");
}

export async function approveManualPaymentAction(formData: FormData) {
  return reviewPaymentAction(formData, "approve");
}

export async function rejectManualPaymentAction(formData: FormData) {
  return reviewPaymentAction(formData, "reject");
}

export async function updatePassengerAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await getCurrentReservationsUserOrRedirect();
  const code = value(formData, "code").toUpperCase();

  if (!code) {
    return errorState("Falta el codigo de reserva. Volve a abrirla desde el listado.");
  }

  const parsed = adminPassengerSchema.safeParse({
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

export async function manageReservationAction(formData: FormData) {
  const command = reservationManagementSchema.safeParse({
    operation: value(formData, "operation"),
    reference: value(formData, "reference"),
    notes: value(formData, "notes")
  });
  if (command.success && command.data.operation === "delete") await getCurrentAdminOrRedirect();
  else await getCurrentReservationsUserOrRedirect();

  const code = value(formData, "code").toUpperCase();
  if (!/^ARC-[A-Z0-9-]+$/.test(code)) redirect("/admin/reservas");
  const detailPath = `/admin/reservas/${code}`;
  if (!command.success) redirect(`${detailPath}?notice=${encodeURIComponent("Revisá los datos ingresados.")}`);

  let result: Awaited<ReturnType<typeof manageReservation>>;
  try {
    result = await manageReservation(code, command.data);
  } catch (error) {
    const message = error instanceof BookingError ? error.message : "No pudimos actualizar la reserva. Intentalo de nuevo.";
    redirect(`${detailPath}?notice=${encodeURIComponent(message)}`);
  }

  let receiptCleanupFailed = false;
  if (result.receiptPath) {
    await del(result.receiptPath).catch(() => { receiptCleanupFailed = true; });
  }
  for (const path of ["/admin/reservas", detailPath, `/reservas/${code}`, "/admin/contabilidad", "/admin/reportes", "/admin/aeropuerto", "/admin/chapelco", "/chofer"]) {
    revalidatePath(path);
  }

  const notices = {
    cancel: "Reserva cancelada.",
    delete: receiptCleanupFailed ? "Reserva borrada. No pudimos eliminar el archivo del comprobante." : "Reserva borrada.",
    confirm: "Reserva confirmada.",
    payment: "Pago registrado.",
    notes: "Notas guardadas."
  };
  const target = command.data.operation === "delete" ? "/admin/reservas" : detailPath;
  redirect(`${target}?notice=${encodeURIComponent(notices[command.data.operation])}`);
}
