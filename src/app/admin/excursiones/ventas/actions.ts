"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { errorState, type AdminFormState } from "@/app/admin/form-state";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { createReservationCode, createReservationShortCode } from "@/lib/booking/codes";
import { passengerDocumentError, normalizePassengerDocument, normalizePassengerPhone } from "@/lib/booking/passenger-contact";
import { createExcursionBooking } from "@/lib/excursions/booking-repository";

/**
 * Alta manual de una venta de excursión (issue #110). El cliente lo pidió textual: las agencias no
 * entran al sistema, «eso va a ser una carga manual nuestra» y hay que poder registrar de qué agencia
 * viene para que salga en la planilla.
 */

const ventaSchema = z.object({
  excursionId: z.string().min(1, "Elegí la excursión."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá la fecha de la salida."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Ingresá la hora de la salida."),
  firstName: z.string().trim().min(2, "Ingresá el nombre del pasajero."),
  lastName: z.string().trim().min(2, "Ingresá el apellido del pasajero."),
  email: z.string().trim().email("Ingresá un email válido.").or(z.literal("")).default(""),
  phone: z.string(),
  documentType: z.string().trim().min(1, "Seleccioná el tipo de documento."),
  documentId: z.string(),
  passengerCount: z.coerce.number().int().min(1, "Tiene que ser al menos un lugar.").max(60, "Máximo 60 lugares."),
  total: z.coerce.number().min(0, "El importe no puede ser negativo."),
  referredBy: z.string().trim().max(120, "El origen puede tener hasta 120 caracteres.").optional().default(""),
  notes: z.string().trim().max(400, "La nota puede tener hasta 400 caracteres.").optional().default("")
});

export async function crearVentaDeExcursionAction(_state: AdminFormState, form: FormData): Promise<AdminFormState> {
  await getCurrentReservationsUserOrRedirect();

  const parsed = ventaSchema.safeParse({
    excursionId: form.get("excursionId"),
    date: form.get("date"),
    time: form.get("time"),
    firstName: form.get("firstName"),
    lastName: form.get("lastName"),
    email: form.get("email") ?? "",
    phone: form.get("phone"),
    documentType: form.get("documentType"),
    documentId: form.get("documentId"),
    passengerCount: form.get("passengerCount"),
    total: form.get("total"),
    referredBy: form.get("referredBy") ?? "",
    notes: form.get("notes") ?? ""
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const campo = issue.path.join(".");
      if (campo && !fieldErrors[campo]) fieldErrors[campo] = issue.message;
    }
    return errorState("Revisá los campos marcados.", fieldErrors);
  }

  const data = parsed.data;
  const documentoError = passengerDocumentError(data.documentType, data.documentId);
  if (documentoError) return errorState("Revisá los campos marcados.", { documentId: documentoError });

  const telefono = normalizePassengerPhone(data.phone);
  if (!telefono) return errorState("Revisá los campos marcados.", { phone: "Ingresá un teléfono válido." });

  const departureAt = new Date(`${data.date}T${data.time}:00.000-03:00`);
  if (Number.isNaN(departureAt.getTime())) {
    return errorState("Revisá los campos marcados.", { date: "La fecha y la hora de salida no son válidas." });
  }

  let creada;
  try {
    creada = await createExcursionBooking({
      excursionId: data.excursionId,
      departureAt,
      passengerCount: data.passengerCount,
      totalCents: Math.round(data.total * 100),
      referredBy: data.referredBy,
      notes: data.notes,
      code: createReservationCode(),
      shortCode: createReservationShortCode(),
      passenger: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: telefono,
        documentType: data.documentType,
        documentId: normalizePassengerDocument(data.documentType, data.documentId)
      }
    });
  } catch {
    return errorState("No pudimos guardar la venta. Intentá nuevamente.");
  }

  redirect(`/admin/excursiones/planilla?date=${data.date}&notice=${encodeURIComponent(`Venta ${creada.shortCode} registrada`)}`);
}
