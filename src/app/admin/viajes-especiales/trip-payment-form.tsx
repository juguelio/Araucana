"use client";

import { startTransition, useActionState } from "react";
import { paymentKinds } from "@/lib/special-trips/data";
import { addTripPayment, type TripFormResult } from "./actions";
import styles from "./trip-form.module.css";

export function TripPaymentForm({ tripId, operationId, currency, today }: {
  tripId: string; operationId: string; currency: string; today: string;
}) {
  const action = addTripPayment.bind(null, tripId, operationId);
  const [state, dispatch, pending] = useActionState(action, {} as TripFormResult);

  return (
    <details className={styles.quickPayment}>
      <summary>Registrar seña o pago</summary>
      <form onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => dispatch(data));
      }}>
        <fieldset className="admin-form-grid" disabled={pending}>
          <input type="hidden" name="currency" value={currency} />
          <label>Tipo de cobro<select name="kind" defaultValue="PAYMENT">
            {Object.entries(paymentKinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
          </select></label>
          <label>Fecha<input type="date" name="date" required defaultValue={today} /></label>
          <label>Importe ({currency})<input name="amount" inputMode="decimal" required /></label>
          <label>Referencia<input name="note" maxLength={500} /></label>
          {state.error && <p className="form-alert error span-2" role="alert">{state.error}</p>}
          <button className="button span-2" type="submit">{pending ? "Registrando…" : "Registrar cobro"}</button>
        </fieldset>
      </form>
    </details>
  );
}
