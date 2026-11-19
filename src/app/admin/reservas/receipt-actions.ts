"use server";

import { revalidatePath } from "next/cache";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { isAdminRole } from "@/lib/auth/roles";
import { ApiError } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/auth/service";
import { DISABILITY_DOCUMENT_PROVIDER } from "@/lib/booking/disability-fare";
import { BookingError, getReservationByCode } from "@/lib/booking/repository";
import { uploadReservationReceipt } from "@/lib/payments/receipt-upload";
import { validateReceiptFile } from "@/lib/payments/receipt-storage";

export type AdminReceiptState = { ok: boolean; message: string };

/**
 * El operador sube el comprobante desde el listado de reservas (modal de la columna «Comprobante»),
 * por ejemplo cuando el pasajero lo mandó por WhatsApp. Es el mismo camino que usa el pasajero
 * desde su link —mismas validaciones de archivo y de estado del pago—, con la sesión del panel.
 * La documentación de la tarifa sin cargo sólo la maneja administración, igual que al revisarla.
 */
export async function uploadReceiptFromAdminAction(_previous: AdminReceiptState, formData: FormData): Promise<AdminReceiptState> {
  const user = await getCurrentReservationsUserOrRedirect();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const receipt = formData.get("receipt");
  if (!/^ARC-[A-Z0-9-]+$/.test(code)) return { ok: false, message: "No encontramos la reserva." };
  if (!(receipt instanceof File) || receipt.size === 0) return { ok: false, message: "Elegí el archivo del comprobante." };
  const invalid = validateReceiptFile(receipt);
  if (invalid) return { ok: false, message: invalid };

  try {
    const reservation = await getReservationByCode(code);
    if (!reservation) return { ok: false, message: "No encontramos la reserva." };
    if (reservation.payment?.provider === DISABILITY_DOCUMENT_PROVIDER && !isAdminRole(user.role)) {
      return { ok: false, message: "La documentación de la tarifa sin cargo la carga administración." };
    }
    await uploadReservationReceipt(code, receipt);
  } catch (error) {
    if (error instanceof ApiError || error instanceof AuthorizationError || error instanceof BookingError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "No pudimos subir el comprobante. Intentalo de nuevo." };
  }

  for (const path of ["/admin", "/admin/reservas", `/admin/reservas/${code}`, `/admin/reservas/${code}/editar`, `/reservas/${code}`]) {
    revalidatePath(path);
  }
  return { ok: true, message: "Comprobante cargado. Ya se puede validar el pago." };
}
