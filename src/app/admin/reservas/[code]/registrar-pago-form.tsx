import { manageReservationAction } from "../actions";

/**
 * Registrar un pago recibido (efectivo, transferencia…) de una reserva: lo usan la página `/pago`
 * y la edición de la reserva. Al guardar vuelve al detalle con el aviso.
 */
export function RegistrarPagoForm({ code, total, method, listQuery }: {
  code: string; total: string; method?: string | null; listQuery?: string;
}) {
  return (
    <>
      <p>Registrá el pago cuando hayas recibido el total de <strong>{total}</strong>.</p>
      <form className={listQuery === undefined ? "admin-form-grid" : "reservas-modal-form"} action={manageReservationAction}>
        {listQuery !== undefined && <input type="hidden" name="listQuery" value={listQuery} />}
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="operation" value="payment" />
        {method && <p>Forma de pago anotada: <strong>{method}</strong>.</p>}
        <label>{method ? "Cambiar forma de pago (opcional)" : "Forma de pago"}<input name="method" maxLength={60} placeholder={method || "Efectivo, transferencia, tarjeta…"} /></label>
        <label>Referencia (opcional)<input name="reference" maxLength={120} /></label>
        <label>
          Comprobante (opcional)
          <input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" />
          <small className="muted">PDF, JPG, PNG o WEBP. Queda guardado junto al pago.</small>
        </label>
        <button className="button" type="submit">Registrar pago</button>
      </form>
    </>
  );
}
