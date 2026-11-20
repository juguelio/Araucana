import { manageReservationAction } from "../actions";
import { receiptAccept, receiptFormatsHelp } from "@/lib/payments/receipt-validation";

/**
 * Registrar un pago recibido (efectivo, transferencia…) de una reserva: lo usan la página `/pago`
 * y la edición de la reserva. Al guardar vuelve al detalle con el aviso.
 */
export function RegistrarPagoForm({ code, total }: { code: string; total: string }) {
  return (
    <>
      <p>Registrá el pago cuando hayas recibido el total de <strong>{total}</strong>.</p>
      <form className="admin-form-grid" action={manageReservationAction}>
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="operation" value="payment" />
        <label>Forma de pago<input name="method" maxLength={60} placeholder="Efectivo, transferencia, tarjeta…" /></label>
        <label>Referencia (opcional)<input name="reference" maxLength={120} /></label>
        <label>
          Comprobante (opcional)
          <input name="receipt" type="file" accept={receiptAccept} />
          <small className="muted">{receiptFormatsHelp} Queda guardado junto al pago.</small>
        </label>
        <button className="button" type="submit">Registrar pago</button>
      </form>
    </>
  );
}
