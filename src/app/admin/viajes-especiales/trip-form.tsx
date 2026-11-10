"use client";

import { startTransition, useActionState, useState } from "react";
import {
  billingModes, emptyLeg, parseMoney, statuses, timezones, type AssignmentInput, type Leg, type PaymentInput
} from "@/lib/special-trips/data";
import styles from "./trip-form.module.css";
import { FleetConflictWarning } from "../fleet-assignment-form";
import { saveTrip, type TripFormResult } from "./actions";

type Option = { id: string; name: string };
type Draft = {
  id: string | null; version: string | null; serviceDate: string; client: string; contact?: string | null;
  passengers?: number | null; status: string; notes?: string | null; legs: Leg[]; assignments: AssignmentInput[];
  billingMode: string; currency: string; total: string; payments: PaymentInput[];
  supplier?: string | null; invoice?: string | null; invoiceDate?: string; paymentStatus?: string | null;
};

export function TripForm({ draft, vehicles, drivers }: { draft: Draft; vehicles: Option[]; drivers: Option[] }) {
  const [legs, setLegs] = useState(draft.legs);
  const [assignments, setAssignments] = useState(draft.assignments);
  const [payments, setPayments] = useState(draft.payments);
  const [total, setTotal] = useState(draft.total);
  const [currency, setCurrency] = useState(draft.currency);
  const [state, dispatch, pending] = useActionState(saveTrip.bind(null, draft.id, draft.version), {} as TripFormResult);
  const paid = payments.reduce((sum, p) => sum + (parseMoney(p.amount) ?? 0), 0);
  const cents = parseMoney(total);
  const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(value / 100);

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget, event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : undefined);
      form.set("legs", JSON.stringify(legs));
      form.set("assignments", JSON.stringify(assignments));
      form.set("payments", JSON.stringify(payments));
      startTransition(() => dispatch(form));
    }}>
      <fieldset disabled={pending} className={styles.form}>
        <section className="plain-card admin-section admin-form-grid">
          <h2 className="span-2">Datos del viaje</h2>
          <label>Cliente o grupo<input name="client" required defaultValue={draft.client} /></label>
          <label>Contacto<input name="contact" defaultValue={draft.contact ?? ""} /></label>
          <label>Fecha del servicio<input name="serviceDate" type="date" required defaultValue={draft.serviceDate} /></label>
          <label>Pasajeros<input name="passengers" type="number" min="1" defaultValue={draft.passengers ?? ""} /></label>
          <label>Estado<select aria-label="Estado" name="status" defaultValue={draft.status}>{Object.entries(statuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label className="span-2">Observaciones<textarea name="notes" defaultValue={draft.notes ?? ""} /></label>
        </section>
        <section className="plain-card admin-section">
          <h2>Itinerario</h2>
          {legs.map((leg, index) => {
            const change = (patch: Partial<Leg>) => setLegs(legs.map((item, i) => i === index ? { ...item, ...patch } : item));
            return <fieldset key={index} className="admin-form-grid">
              <legend>Tramo {index + 1}</legend>
              <label>Origen<input value={leg.origin} onChange={(e) => change({ origin: e.target.value })} /></label>
              <label>Destino<input value={leg.destination} onChange={(e) => change({ destination: e.target.value })} /></label>
              <label>País<select aria-label="País" value={leg.country} onChange={(e) => change({ country: e.target.value as Leg["country"] })}><option value="AR">Argentina</option><option value="CL">Chile</option><option value="AR_CL">Argentina y Chile</option></select></label>
              <label>Zona horaria de salida<select aria-label="Zona horaria de salida" value={leg.zone} onChange={(e) => change({ zone: e.target.value as Leg["zone"] })}>{timezones.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
              <label>Salida<input type="datetime-local" value={leg.departure} onChange={(e) => change({ departure: e.target.value })} /></label>
              <label>Llegada<input type="datetime-local" value={leg.arrival} onChange={(e) => change({ arrival: e.target.value })} /></label>
              <label>Zona horaria de llegada<select aria-label="Zona horaria de llegada" value={leg.arrivalZone ?? ""} onChange={(e) => change({ arrivalZone: (e.target.value || undefined) as Leg["arrivalZone"] })}>
                <option value="">La misma que la salida</option>{timezones.map((zone) => <option key={zone}>{zone}</option>)}
              </select></label>
              <label>Paradas<input value={leg.stops} onChange={(e) => change({ stops: e.target.value })} /></label>
              <label>Descripción<textarea value={leg.description} onChange={(e) => change({ description: e.target.value })} /></label>
              <label className={styles.checkbox}><input type="checkbox" checked={leg.included} onChange={(e) => change({ included: e.target.checked })} /> Incluido en el paquete</label>
              {legs.length > 1 && <button type="button" className="ghost-button" onClick={() => setLegs(legs.filter((_, i) => i !== index))}>Quitar tramo {index + 1}</button>}
            </fieldset>;
          })}
          <button type="button" className="ghost-button" onClick={() => setLegs([...legs, emptyLeg])}>Agregar tramo</button>
        </section>
        <section className="plain-card admin-section">
          <h2>Ocupación de naves</h2>
          <p className="muted">Ingresá el intervalo durante el que la nave no estará disponible, en hora argentina.</p>
          {assignments.map((assignment, index) => {
            const change = (patch: Partial<AssignmentInput>) => setAssignments(assignments.map((item, i) => i === index ? { ...item, ...patch } : item));
            return <fieldset key={index} className="admin-form-grid">
              <legend>Ocupación {index + 1}</legend>
              <label>Nave<select aria-label="Nave" required value={assignment.vehicleId} onChange={(e) => change({ vehicleId: e.target.value })}><option value="">Elegí una nave</option>{vehicles.map((v) => <option value={v.id} key={v.id}>{v.name}</option>)}</select></label>
              <label>Chofer<select aria-label="Chofer" value={assignment.driverId} onChange={(e) => change({ driverId: e.target.value })}><option value="">Sin asignar</option>{drivers.map((d) => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
              <label>Desde<input required type="datetime-local" value={assignment.start} onChange={(e) => change({ start: e.target.value })} /></label>
              <label>Hasta<input required type="datetime-local" value={assignment.end} onChange={(e) => change({ end: e.target.value })} /></label>
              <button type="button" className="ghost-button" onClick={() => setAssignments(assignments.filter((_, i) => i !== index))}>Quitar ocupación {index + 1}</button>
            </fieldset>;
          })}
          <button type="button" className="ghost-button" onClick={() => setAssignments([...assignments, { vehicleId: "", driverId: "", start: "", end: "" }])}>Agregar ocupación</button>
        </section>
        <section className="plain-card admin-section admin-form-grid">
          <h2 className="span-2">Cobros y facturación</h2>
          <label>Condición<select aria-label="Condición" name="billingMode" defaultValue={draft.billingMode}>{Object.entries(billingModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Moneda<select aria-label="Moneda" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}><option>ARS</option><option>USD</option></select></label>
          <label>Total<input name="total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
          <p>Cobrado {money(paid)} · Saldo {cents === null ? "sin determinar" : money(cents - paid)}</p>
          {payments.map((payment, index) => {
            const change = (patch: Partial<PaymentInput>) => setPayments(payments.map((item, i) => i === index ? { ...item, ...patch } : item));
            return <fieldset className="span-2 admin-form-grid" key={index}>
              <legend>Cobro {index + 1}</legend>
              <label>Fecha<input type="date" value={payment.date} onChange={(e) => change({ date: e.target.value })} /></label>
              <label>Importe<input required inputMode="decimal" value={payment.amount} onChange={(e) => change({ amount: e.target.value })} /></label>
              <label>Referencia (por ejemplo, seña)<input value={payment.note} onChange={(e) => change({ note: e.target.value })} /></label>
              <button type="button" className="ghost-button" onClick={() => setPayments(payments.filter((_, i) => i !== index))}>Quitar cobro {index + 1}</button>
            </fieldset>;
          })}
          <button type="button" className="ghost-button span-2" onClick={() => setPayments([...payments, { date: "", amount: "", note: "" }])}>Agregar cobro</button>
          <label>Proveedor<input name="supplier" defaultValue={draft.supplier ?? ""} /></label>
          <label>Factura<input name="invoice" defaultValue={draft.invoice ?? ""} /></label>
          <label>Fecha de factura<input name="invoiceDate" type="date" defaultValue={draft.invoiceDate} /></label>
          <label>Estado de pago<input name="paymentStatus" defaultValue={draft.paymentStatus ?? ""} /></label>
        </section>
        {state.error && <p role="alert">{state.error}</p>}
        <FleetConflictWarning conflicts={state.conflicts} confirmation={state.confirmation} />
        <button className="button" type="submit">{pending ? "Guardando…" : "Guardar viaje"}</button>
      </fieldset>
    </form>
  );
}
