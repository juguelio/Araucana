"use server";

import { parseReservationPrice, reservationPriceError } from "@/lib/booking/admin-price";
import { del } from "@vercel/blob";
import { manageReservation, reservationManagementSchema } from "@/lib/booking/admin-management";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAdminOrRedirect, getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { reviewDisabilityDocument, approveManualPayment, rejectManualPayment, BookingError, createWebReservation } from "@/lib/booking/repository";
import { adminReservationSchema, adminPassengerPatchSchema } from "@/lib/booking/validation";
import {
  errorState,
  fieldErrorsFromZodError,
  type AdminFormState
} from "../form-state";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

export async function createAdminReservationAction(formData: FormData) {
  const creator = await getCurrentReservationsUserOrRedirect();

  const customPrice = value(formData, "customPrice");
  const overrideTotalCents = customPrice ? parseReservationPrice(customPrice) : undefined;
  if (overrideTotalCents === null) redirect(`/admin/reservas/nueva?notice=${encodeURIComponent(reservationPriceError)}`);
  const parsed = adminReservationSchema.safeParse({
    overrideTotalCents,
    scheduleId: value(formData, "scheduleId"),
    requestDisabilityFare: formData.get("requestDisabilityFare") === "on",
    dropoffStop: value(formData, "dropoffStop") || undefined,
    referredBy: value(formData, "referredBy") || undefined,
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
    reservation = await createWebReservation(parsed.data, { fromAdmin: true, creator });
  } catch (error) {
    const message = error instanceof BookingError && error.code === "AIRPORT_SCHEDULE_NOT_BOOKABLE"
      ? error.message
      : error instanceof BookingError && error.code === "CAPACITY_FULL"
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

export async function updateReservationAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await getCurrentReservationsUserOrRedirect();
  const code = value(formData, "code").toUpperCase();
  if (!/^ARC-[A-Z0-9-]+$/.test(code)) return errorState("No encontramos la reserva.");

  const passenger = Object.fromEntries(Object.keys(adminPassengerPatchSchema.shape)
    .filter((key) => formData.has(key))
    .map((key) => {
      const text = value(formData, key);
      return [key, key === "email" ? text.toLowerCase() : key === "nationality" ? text || null : text];
    }));
  const notes = formData.has("notes") ? value(formData, "notes") : undefined;
  // Sólo viaja si el formulario lo mandó: así una edición que no toca el origen no lo borra.
  const referredBy = formData.has("referredBy") ? value(formData, "referredBy") : undefined;
  let pickup;
  if (formData.has("address")) {
    const latitude = value(formData, "latitude");
    const longitude = value(formData, "longitude");
    if (!latitude || !longitude || formData.get("confirmed") !== "on") {
      return errorState("Confirmá el punto de traslado en el mapa.");
    }
    pickup = { address: value(formData, "address"), point: [Number(latitude), Number(longitude)] };
  }
  const priceChanged = formData.has("customPrice");
  const paymentChanged = formData.has("method") || formData.has("reference");
  const totalCents = priceChanged ? parseReservationPrice(value(formData, "customPrice")) : undefined;
  if (totalCents === null) return errorState(reservationPriceError, { customPrice: reservationPriceError });
  const financial = priceChanged || paymentChanged ? {
    operation: value(formData, "financialOperation"),
    totalCents,
    method: formData.has("method") ? value(formData, "method") : undefined,
    reference: formData.has("reference") ? value(formData, "reference") : undefined
  } : undefined;
  if (!pickup && notes === undefined && referredBy === undefined && !financial && Object.keys(passenger).length === 0) {
    return errorState("No hay cambios para guardar.");
  }

  const command = reservationManagementSchema.safeParse({ operation: "edit", passenger, pickup, notes, referredBy, financial });
  if (!command.success) {
    return errorState("Revisá los datos para guardar la reserva.", fieldErrorsFromZodError(command.error));
  }

  try {
    await manageReservation(code, command.data);
  } catch (error) {
    const message = error instanceof BookingError ? error.message : "No pudimos guardar los cambios. Intentalo de nuevo.";
    return errorState(message, error instanceof BookingError && error.code === "INVALID_PASSENGER_DOCUMENT"
      ? { documentId: message } : {});
  }

  for (const path of ["/admin/reservas", `/admin/reservas/${code}`, `/admin/reservas/${code}/editar`, `/reservas/${code}`, "/admin/aeropuerto", "/admin/chapelco", "/chofer", "/admin/contabilidad", "/admin/reportes"]) {
    revalidatePath(path);
  }
  redirect(reservationNotice(`/admin/reservas/${code}`, "Cambios guardados."));
}

function reservationNotice(path: string, message: string, query = "") {
  const params = new URLSearchParams(query);
  params.set("notice", message);
  return `${path}?${params.toString()}`;
}

export async function manageReservationAction(formData: FormData) {
  const command = reservationManagementSchema.safeParse({
    operation: value(formData, "operation"),
    reason: value(formData, "reason"),
    totalCents: parseReservationPrice(value(formData, "customPrice")),
    method: value(formData, "method"),
    reference: value(formData, "reference")
  });
  const user = command.success && command.data.operation === "delete"
    ? await getCurrentAdminOrRedirect()
    : await getCurrentReservationsUserOrRedirect();

  const code = value(formData, "code").toUpperCase();
  if (!/^ARC-[A-Z0-9-]+$/.test(code)) redirect("/admin/reservas");
  const detailPath = `/admin/reservas/${code}`;
  const listQuery = formData.has("listQuery") ? value(formData, "listQuery").slice(0, 4096) : null;
  const returnPath = listQuery === null ? detailPath : "/admin/reservas";
  if (!command.success || command.data.operation === "edit") {
    const invalidPrice = !command.success && command.error.issues.some((issue) => issue.path[0] === "totalCents");
    const invalidReason = !command.success && command.error.issues.some((issue) => issue.path[0] === "reason");
    redirect(reservationNotice(returnPath, invalidReason ? "Escribí el motivo de la cancelación (al menos 3 caracteres)." : invalidPrice ? reservationPriceError : "Revisá los datos ingresados.", listQuery ?? ""));
  }

  let result: Awaited<ReturnType<typeof manageReservation>>;
  try {
    result = await manageReservation(
      code,
      command.data.operation === "cancel"
        ? { ...command.data, cancelledBy: user.name?.trim() || user.email }
        : command.data.operation === "restore"
          ? { ...command.data, restoredBy: user.name?.trim() || user.email }
          : command.data
    );
  } catch (error) {
    const message = error instanceof BookingError ? error.message : "No pudimos actualizar la reserva. Intentalo de nuevo.";
    redirect(reservationNotice(returnPath, message, listQuery ?? ""));
  }

  let receiptCleanupFailed = false;
  if (result.receiptPath) {
    await del(result.receiptPath).catch(() => { receiptCleanupFailed = true; });
  }
  for (const path of ["/admin/reservas", detailPath, `${detailPath}/editar`, `${detailPath}/pago`, `/reservas/${code}`, "/admin/contabilidad", "/admin/reportes", "/admin/aeropuerto", "/admin/chapelco", "/chofer"]) {
    revalidatePath(path);
  }

  const notices = {
    cancel: "Reserva cancelada.",
    restore: "Reserva restituida.",
    delete: receiptCleanupFailed ? "Reserva borrada. No pudimos eliminar el archivo del comprobante." : "Reserva borrada.",
    confirm: "Reserva confirmada.",
    payment: "Pago registrado.",
    correctPayment: "Datos del pago actualizados.",
    price: "Precio actualizado."
  };
  const target = command.data.operation === "delete" ? "/admin/reservas" : returnPath;
  redirect(reservationNotice(target, notices[command.data.operation], listQuery ?? ""));
}
