"use server";

import { parseReservationPrice, reservationPriceError } from "@/lib/booking/admin-price";
import { del } from "@vercel/blob";
import { ApiError } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/auth/service";
import { uploadReservationReceipt } from "@/lib/payments/receipt-upload";
import { validateReceiptFile } from "@/lib/payments/receipt-storage";
import { manageReservation, reservationManagementSchema } from "@/lib/booking/admin-management";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAdminOrRedirect, getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { reviewDisabilityDocument, approveManualPayment, rejectManualPayment, BookingError, createRouteRoundTripReservation, createWebReservation } from "@/lib/booking/repository";
import { adminReservationSchema, adminPassengerPatchSchema, adminRouteRoundTripSchema } from "@/lib/booking/validation";
import {
  errorState,
  fieldErrorsFromZodError,
  type AdminFormState
} from "../form-state";

const INVALID_RECEIPT = "invalid:";

function receiptFile(formData: FormData) {
  const entry = formData.get("receipt");
  return entry instanceof File && entry.size > 0 ? entry : null;
}

/**
 * Sube el comprobante antes de registrar el pago. Devuelve `null` si quedó adjunto, el motivo si la
 * reserva no lo admite (el pago se registra igual y se avisa) o `INVALID_RECEIPT` + motivo si el
 * archivo es inválido (no se registra nada, para que el operador elija otro).
 */
async function attachReceiptBeforePayment(code: string, receipt: File): Promise<string | null> {
  try {
    await uploadReservationReceipt(code, receipt);
    return null;
  } catch (error) {
    if (error instanceof ApiError && error.code === "VALIDATION_ERROR") return `${INVALID_RECEIPT}${error.message}`;
    if (error instanceof ApiError || error instanceof BookingError || error instanceof AuthorizationError) return error.message;
    return "No pudimos subir el archivo.";
  }
}

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

export async function createAdminReservationAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const creator = await getCurrentReservationsUserOrRedirect();

  const customPrice = value(formData, "customPrice");
  const overrideTotalCents = customPrice ? parseReservationPrice(customPrice) : undefined;
  // Los errores vuelven como estado del formulario, no como `?notice=`: el usuario ve el campo
  // marcado, el foco va ahí y no pierde lo que ya cargó (#242).
  if (overrideTotalCents === null) return errorState(reservationPriceError, { customPrice: reservationPriceError });
  // Con «+ Agregar vuelta» el formulario manda la salida de la vuelta: se crean los dos tramos juntos.
  if (value(formData, "returnScheduleId")) return createAdminRouteRoundTrip(formData, overrideTotalCents, creator);
  const parsed = adminReservationSchema.safeParse({
    overrideTotalCents,
    scheduleId: value(formData, "scheduleId"),
    requestDisabilityFare: formData.get("requestDisabilityFare") === "on",
    dropoffStop: value(formData, "dropoffStop") || undefined,
    referredBy: value(formData, "referredBy") || undefined,
    passengerCount: value(formData, "passengerCount"),
    // Los menores se cargaban en el formulario pero no llegaban: la reserva quedaba toda con tarifa
    // entera (18-nov). Ahora viajan como en la reserva web.
    halfFareCount: value(formData, "halfFareCount") || 0,
    freeFareCount: value(formData, "freeFareCount") || 0,
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
    const fieldErrors = fieldErrorsFromZodError(parsed.error);
    const cantidad = Object.keys(fieldErrors).length;
    const primero = parsed.error.issues[0]?.message ?? "Revisá los datos de la reserva.";
    return errorState(cantidad > 1 ? `Hay ${cantidad} datos para revisar.` : primero, fieldErrors);
  }

  let reservation: Awaited<ReturnType<typeof createWebReservation>>;
  try {
    reservation = await createWebReservation(parsed.data, { fromAdmin: true, creator });
  } catch (error) {
    return errorState(mensajeDeAlta(error));
  }

  revalidatePath("/admin/reservas");
  revalidatePath(`/admin/reservas/${reservation.code}`);
  revalidatePath(`/reservar/${reservation.route.slug}`);
  redirect(`/admin/reservas/${reservation.code}`);
}

/** Lo que ve quien carga la reserva cuando el alta no sale. */
function mensajeDeAlta(error: unknown) {
  if (!(error instanceof BookingError)) return "No pudimos crear la reserva. Intentalo nuevamente.";
  switch (error.code) {
    case "AIRPORT_SCHEDULE_NOT_BOOKABLE":
    case "DISABILITY_FARE_NOT_AVAILABLE":
    case "ROUND_TRIP_ROUTE_MISMATCH":
    case "INVALID_ROUND_TRIP_ORDER":
      return error.message;
    case "CAPACITY_FULL":
      return "No hay suficientes asientos disponibles para esa salida.";
    case "SCHEDULE_CLOSED":
      return "Una de las salidas ya no admite reservas. Volvé a elegir.";
    case "BOOKING_BUSY":
      return "La salida está recibiendo otras reservas en este momento. Intentalo nuevamente.";
    case "STOP_NOT_AVAILABLE":
      return "La parada seleccionada ya no está disponible. Volvé a elegir.";
    default:
      return "No pudimos crear la reserva. Intentalo nuevamente.";
  }
}

/**
 * Ida y vuelta de una ruta regular (pedido de Jugue, 18-nov): las dos reservas se crean juntas con el
 * mismo pasajero, y el panel abre la de ida, que muestra el otro tramo.
 */
async function createAdminRouteRoundTrip(
  formData: FormData,
  overrideTotalCents: number | undefined,
  creator: Awaited<ReturnType<typeof getCurrentReservationsUserOrRedirect>>
): Promise<AdminFormState> {
  const parsed = adminRouteRoundTripSchema.safeParse({
    overrideTotalCents,
    scheduleId: value(formData, "scheduleId"),
    returnScheduleId: value(formData, "returnScheduleId"),
    requestDisabilityFare: formData.get("requestDisabilityFare") === "on",
    dropoffStop: value(formData, "dropoffStop") || undefined,
    returnDropoffStop: value(formData, "returnDropoffStop") || undefined,
    referredBy: value(formData, "referredBy") || undefined,
    passengerCount: value(formData, "passengerCount"),
    halfFareCount: value(formData, "halfFareCount") || 0,
    freeFareCount: value(formData, "freeFareCount") || 0,
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
    const fieldErrors = fieldErrorsFromZodError(parsed.error);
    const cantidad = Object.keys(fieldErrors).length;
    const primero = parsed.error.issues[0]?.message ?? "Revisá los datos de la reserva.";
    return errorState(cantidad > 1 ? `Hay ${cantidad} datos para revisar.` : primero, fieldErrors);
  }

  let viaje: Awaited<ReturnType<typeof createRouteRoundTripReservation>>;
  try {
    viaje = await createRouteRoundTripReservation(parsed.data, { creator });
  } catch (error) {
    return errorState(mensajeDeAlta(error));
  }

  revalidatePath("/admin/reservas");
  for (const tramo of [viaje.ida, viaje.vuelta]) {
    revalidatePath(`/admin/reservas/${tramo.code}`);
    revalidatePath(`/reservar/${tramo.route.slug}`);
  }
  redirect(`/admin/reservas/${viaje.ida.code}`);
}

async function reviewPaymentAction(formData: FormData, decision: "approve" | "reject") {
  const actor = await getCurrentReservationsUserOrRedirect();
  const code = value(formData, "code").toUpperCase();
  if (!code) redirect(`/admin/reservas?notice=${encodeURIComponent("Falta el código de reserva.")}`);
  try {
    await (decision === "approve" ? approveManualPayment(code, actor) : rejectManualPayment(code, actor));
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
  const actor = await getCurrentAdminOrRedirect();
  const code = value(formData, "code");
  try {
    await reviewDisabilityDocument(code, decision, value(formData, "receiptVersion"), actor);
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
  const actor = await getCurrentReservationsUserOrRedirect();
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
    const address = value(formData, "address");
    const latitude = value(formData, "latitude");
    const longitude = value(formData, "longitude");
    if (Boolean(latitude) !== Boolean(longitude)) {
      return errorState("El punto del mapa quedó incompleto. Marcá de nuevo el lugar.");
    }
    if (latitude && longitude) {
      if (formData.get("confirmed") !== "on") {
        return errorState("Confirmá el punto de traslado en el mapa.");
      }
      pickup = { address, point: [Number(latitude), Number(longitude)] };
    } else if (address) {
      // Sin coordenadas (#268): el alojamiento que no está en el mapa se guarda como texto, el
      // mismo camino que una dirección sin geometría. La pantalla avisa que va sin punto.
      pickup = { address, point: null };
    } else {
      return errorState("Confirmá el punto de traslado en el mapa.");
    }
  }
  const priceChanged = formData.has("customPrice");
  const paymentChanged = formData.has("method") || formData.has("reference");
  const totalCents = priceChanged ? parseReservationPrice(value(formData, "customPrice")) : undefined;
  if (totalCents === null) return errorState(reservationPriceError, { customPrice: reservationPriceError });
  // Cantidad de pasajeros y equipaje (#267): sólo viajan si el formulario los mandó, así una
  // edición que no los toca no los reescribe.
  const passengerCount = formData.has("passengerCount") ? value(formData, "passengerCount") : undefined;
  const sportsLuggageCount = formData.has("sportsLuggageCount") ? value(formData, "sportsLuggageCount") : undefined;
  const financial = priceChanged || paymentChanged ? {
    operation: value(formData, "financialOperation"),
    totalCents,
    method: formData.has("method") ? value(formData, "method") : undefined,
    reference: formData.has("reference") ? value(formData, "reference") : undefined
  } : undefined;
  if (!pickup && notes === undefined && referredBy === undefined && !financial
    && passengerCount === undefined && sportsLuggageCount === undefined && Object.keys(passenger).length === 0) {
    return errorState("No hay cambios para guardar.");
  }

  const command = reservationManagementSchema.safeParse({
    operation: "edit", passenger, pickup, notes, referredBy, financial,
    passengerCount, sportsLuggageCount,
    acknowledgeTotalChange: formData.get("acknowledgeTotalChange") === "on"
  });
  if (!command.success) {
    return errorState("Revisá los datos para guardar la reserva.", fieldErrorsFromZodError(command.error));
  }

  try {
    await manageReservation(code, command.data, actor);
  } catch (error) {
    const message = error instanceof BookingError ? error.message : "No pudimos guardar los cambios. Intentalo de nuevo.";
    return errorState(message, error instanceof BookingError && error.code === "INVALID_PASSENGER_DOCUMENT"
      ? { documentId: message }
      : error instanceof BookingError && (error.code === "CAPACITY_FULL" || error.code === "INVALID_PASSENGER_COUNT")
        ? { passengerCount: message }
        : {});
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

  // Registrar el pago con su comprobante: el archivo se adjunta primero, mientras el pago todavía está
  // pendiente (después de aprobado ya no admite comprobantes), y recién después se aprueba el pago.
  const receipt = command.data.operation === "payment" ? receiptFile(formData) : null;
  let receiptProblem: string | null = null;
  if (receipt) {
    const invalid = validateReceiptFile(receipt);
    if (invalid) redirect(reservationNotice(returnPath, invalid, listQuery ?? ""));
    receiptProblem = await attachReceiptBeforePayment(code, receipt);
    if (receiptProblem?.startsWith(INVALID_RECEIPT)) {
      redirect(reservationNotice(returnPath, receiptProblem.slice(INVALID_RECEIPT.length), listQuery ?? ""));
    }
  }

  let result: Awaited<ReturnType<typeof manageReservation>>;
  try {
    result = await manageReservation(
      code,
      command.data.operation === "cancel"
        ? { ...command.data, cancelledBy: user.name?.trim() || user.email }
        : command.data.operation === "restore"
          ? { ...command.data, restoredBy: user.name?.trim() || user.email }
          : command.data,
      user
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
    payment: !receipt ? "Pago registrado." : receiptProblem
      ? `Pago registrado, pero el comprobante no se adjuntó: ${receiptProblem} Podés subirlo desde el listado.`
      : "Pago registrado con su comprobante.",
    correctPayment: "Datos del pago actualizados.",
    price: "Precio actualizado."
  };
  const target = command.data.operation === "delete" ? "/admin/reservas" : returnPath;
  redirect(reservationNotice(target, notices[command.data.operation], listQuery ?? ""));
}
