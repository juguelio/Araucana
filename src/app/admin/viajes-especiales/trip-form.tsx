"use client";

import { startTransition, useActionState, useState } from "react";
import {
  billingModes, emptyLeg, localInput, MAX_TRIP_PAYMENTS, parseMoney, paymentKinds, statuses,
  tripPaymentTotals, type AssignmentInput, type PaymentInput, type Leg
} from "@/lib/special-trips/data";
import styles from "./trip-form.module.css";
import { TripItinerary } from "./trip-itinerary";
import { TripFleetModal } from "./trip-fleet-modal";
import { FleetConflictWarning } from "../fleet-assignment-form";
import { saveTrip, type TripFormResult } from "./actions";
import { cantidadDias, navesQueNoCubren, ocupacionDelViaje } from "@/lib/special-trips/rango";

type Option = { id: string; name: string; email?: string; internalNumber?: string | null; licensePlate?: string | null };
type Draft = {
  id: string | null; version: string | null; serviceDate: string; endDate: string; client: string; contact?: string | null;
  contactName?: string | null; contactPhone?: string | null;
  passengers?: number | null; status: string; notes?: string | null; legs: Leg[]; assignments: AssignmentInput[];
  billingMode: string; currency: string; total: string; payments: PaymentInput[];
  supplier?: string | null; invoice?: string | null; invoiceDate?: string; paymentStatus?: string | null;
};

export function TripForm({ draft, vehicles, drivers }: { draft: Draft; vehicles: Option[]; drivers: Option[] }) {
  const [legs, setLegs] = useState(draft.legs.length ? draft.legs : [emptyLeg]);
  const [assignments, setAssignments] = useState(draft.assignments);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [version, setVersion] = useState(draft.version);
  const [payments, setPayments] = useState(draft.payments);
  const [total, setTotal] = useState(draft.total);
  const [currency, setCurrency] = useState(draft.currency);
  const [billingMode, setBillingMode] = useState(draft.billingMode);
  // Sale el / vuelve el: con la vuelta cargada el viaje figura en cada día y la nave queda ocupada el bloque.
  const [serviceDate, setServiceDate] = useState(draft.serviceDate);
  const [endDate, setEndDate] = useState(draft.endDate);
  const diaDe = (clave: string) => new Date(clave + "T00:00:00Z");
  const fechasValidas = /^\d{4}-\d{2}-\d{2}$/.test(serviceDate) && (!endDate || /^\d{4}-\d{2}-\d{2}$/.test(endDate));
  const dias = fechasValidas && endDate >= serviceDate ? cantidadDias({ serviceDate: diaDe(serviceDate), endDate: endDate ? diaDe(endDate) : null }) : 1;
  const bloque = ocupacionDelViaje(serviceDate, endDate);
  const sinCubrir = dias > 1 ? navesQueNoCubren(assignments, serviceDate, endDate) : [];
  const nombreNave = (id: string) => vehicles.find((v) => v.id === id)?.name ?? "La nave";
  const [state, dispatch, pending] = useActionState(saveTrip.bind(null, draft.id, version), {} as TripFormResult);
  const cents = parseMoney(total);
  const { paid, balance } = tripPaymentTotals(cents, payments);
  const formatter = new Intl.NumberFormat("es-AR", { style: "currency", currency });
  const money = (value: number) => formatter.format(value / 100);
  const origin = legs[0]?.origin.trim();
  const destination = legs.at(-1)?.destination.trim();
  const showDescriptions = Boolean(draft.id && draft.legs.some((leg) => leg.description && (!leg.origin || !leg.destination)));

  function addPayment(kind: NonNullable<PaymentInput["kind"]>) {
    setPayments((items) => [...items, { date: localInput(new Date()).slice(0, 10), amount: "", note: "", kind }]);
  }

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      if (savingAssignments) return;
      const form = new FormData(event.currentTarget, event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : undefined);
      form.set("legs", JSON.stringify(legs));
      form.set("assignments", JSON.stringify(assignments));
      form.set("payments", JSON.stringify(payments));
      startTransition(() => dispatch(form));
    }}>
      <fieldset disabled={pending} className={styles.form}>
        <TripItinerary legs={legs} setLegs={setLegs} serviceDate={serviceDate} endDate={endDate}
          setServiceDate={setServiceDate} setEndDate={setEndDate} currency={currency} showDescriptions={showDescriptions} />
        <div className="checkout-layout">
          <div className="checkout-main">
            <section className={`plain-card admin-section ${styles.section}`}>
              <h2>Cliente y contacto</h2>
              <div className="admin-form-grid">
                <label>Cliente o grupo<input name="client" required maxLength={500} defaultValue={draft.client} /></label>
                {draft.contact ? <label>Contacto del registro original<input name="contact" maxLength={500} defaultValue={draft.contact} /></label> : null}
                <label>Nombre de referencia<input name="contactName" maxLength={120} autoComplete="name" defaultValue={draft.contactName ?? ""} /></label>
                <label>Teléfono de contacto<input name="contactPhone" type="tel" maxLength={32} autoComplete="tel" defaultValue={draft.contactPhone ?? ""} /></label>
                <label>Pasajeros<input name="passengers" type="number" min="1" max="100000" defaultValue={draft.passengers ?? ""} /></label>
                <label>Estado<select name="status" defaultValue={draft.status}>{Object.entries(statuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
                <label className="span-2">Observaciones<textarea name="notes" maxLength={12000} defaultValue={draft.notes ?? ""} /></label>
              </div>
            </section>
            <section className={`plain-card admin-section ${styles.section}`}>
              <h2>Naves y choferes</h2>
              <p className="muted">Ingresá el intervalo durante el que la nave no estará disponible, en hora argentina.{dias > 1 ? ` Al agregar una, se propone el viaje entero (${dias} días).` : ""}</p>
              {sinCubrir.length > 0 && <div className={styles.aviso} role="status">
                <p>{sinCubrir.map((a) => nombreNave(a.vehicleId)).join(", ")} no {sinCubrir.length === 1 ? "queda ocupada" : "quedan ocupadas"} todos los días del viaje: el tablero la{sinCubrir.length === 1 ? "" : "s"} va a mostrar libre{sinCubrir.length === 1 ? "" : "s"} mientras está afuera.</p>
                {!draft.id && <button type="button" className="ghost-button" onClick={() => setAssignments(assignments.map((a) => sinCubrir.includes(a) ? { ...a, ...bloque } : a))}>Ocupar los {dias} días</button>}
              </div>}
              {draft.id && version ? (
                <TripFleetModal id={draft.id} version={version} client={draft.client} assignments={assignments}
                  vehicles={vehicles} drivers={drivers} range={bloque} disabled={pending} onSavingChange={setSavingAssignments}
                  extend={sinCubrir.length ? { days: dias, assignments: assignments.map((a) => sinCubrir.includes(a) ? { ...a, ...bloque } : a) } : undefined}
                  onSaved={(next, savedVersion) => { setVersion(savedVersion); setAssignments(next); }} />
              ) : <>
              {assignments.map((assignment, index) => {
                const change = (patch: Partial<AssignmentInput>) => setAssignments(assignments.map((item, i) => i === index ? { ...item, ...patch } : item));
                return <fieldset key={index} className="admin-form-grid">
                  <legend>Unidad {index + 1}</legend>
                  <label>Nave<select aria-label="Nave" required value={assignment.vehicleId} onChange={(e) => change({ vehicleId: e.target.value })}><option value="">Elegí una nave</option>{vehicles.map((v) => <option value={v.id} key={v.id}>{v.name}</option>)}</select></label>
                  <label>Chofer<select aria-label="Chofer" value={assignment.driverId} onChange={(e) => change({ driverId: e.target.value })}><option value="">Sin asignar</option>{drivers.map((d) => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
                  <label>Desde<input required type="datetime-local" value={assignment.start} onChange={(e) => change({ start: e.target.value })} /></label>
                  <label>Hasta<input required type="datetime-local" value={assignment.end} onChange={(e) => change({ end: e.target.value })} /></label>
                  <button type="button" className="ghost-button" onClick={() => setAssignments(assignments.filter((_, i) => i !== index))}>Quitar unidad {index + 1}</button>
                </fieldset>;
              })}
              <button type="button" className="ghost-button" onClick={() => setAssignments([...assignments, { vehicleId: "", driverId: "", ...bloque }])}>{assignments.length ? "Agregar otra nave" : "Agregar nave y chofer"}</button>
              </>}
            </section>
            <section className={`plain-card admin-section ${styles.section}`} id="cobros">
              <h2>Precio y cobros</h2>
              <div className="admin-form-grid">
                <label>Importe acordado<input name="total" inputMode="decimal" placeholder="Ej. 450000" value={total} onChange={(e) => {
                  setTotal(e.target.value);
                  if (e.target.value && billingMode === "UNKNOWN") setBillingMode("FIXED");
                }} /></label>
                <label>Moneda<select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}><option>ARS</option><option>USD</option></select></label>
                <label className="span-2">Condición de cobro<select name="billingMode" value={billingMode} onChange={(e) => setBillingMode(e.target.value)}>{Object.entries(billingModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              </div>
              {payments.map((payment, index) => {
                const change = (patch: Partial<PaymentInput>) => setPayments(payments.map((item, i) => i === index ? { ...item, ...patch } : item));
                return <fieldset className="admin-form-grid" key={payment.id ?? index}>
                  <legend>{payment.kind ? paymentKinds[payment.kind] : "Cobro"} {index + 1}</legend>
                  <label>Fecha<input type="date" required={Boolean(payment.kind)} value={payment.date} onChange={(e) => change({ date: e.target.value })} /></label>
                  <label>Importe<input required inputMode="decimal" value={payment.amount} onChange={(e) => change({ amount: e.target.value })} /></label>
                  <label className="span-2">Referencia del cobro<input maxLength={500} value={payment.note} onChange={(e) => change({ note: e.target.value })} /></label>
                  <button type="button" className="ghost-button" onClick={() => setPayments(payments.filter((_, i) => i !== index))}>Quitar cobro {index + 1}</button>
                </fieldset>;
              })}
              <div className={`inline-actions ${styles.paymentActions}`}>
                <button type="button" className="ghost-button" disabled={payments.length >= MAX_TRIP_PAYMENTS} onClick={() => addPayment("DEPOSIT")}>Cargar seña</button>
                <button type="button" className="ghost-button" disabled={payments.length >= MAX_TRIP_PAYMENTS} onClick={() => addPayment("PAYMENT")}>Agregar pago</button>
              </div>
              <details open={draft.supplier || draft.invoice || draft.invoiceDate || draft.paymentStatus ? true : undefined}>
                <summary>Datos de facturación</summary>
                <div className="admin-form-grid">
                  <label>Proveedor<input name="supplier" defaultValue={draft.supplier ?? ""} /></label>
                  <label>Factura<input name="invoice" defaultValue={draft.invoice ?? ""} /></label>
                  <label>Fecha de factura<input name="invoiceDate" type="date" defaultValue={draft.invoiceDate} /></label>
                  <label>Nota de pago<input name="paymentStatus" defaultValue={draft.paymentStatus ?? ""} /></label>
                </div>
              </details>
            </section>
          </div>
          <aside className="checkout-summary plain-card">
            <h2 className="route-title">Resumen del viaje</h2>
            <div className="summary-list" aria-live="polite">
              <div><span>Inicio</span><strong>{origin || "Por definir"}</strong></div>
              <div><span>Fin</span><strong>{destination || "Por definir"}</strong></div>
              <div><span>Duración</span><strong>{dias} {dias === 1 ? "día" : "días"}</strong></div>
              <div><span>Importe acordado</span><strong>{cents === null ? "Por confirmar" : money(cents)}</strong></div>
              <div><span>Cobrado</span><strong>{money(paid)}</strong></div>
              <div><span>{balance !== null && balance < 0 ? "Saldo a favor" : "Saldo pendiente"}</span><strong>{balance === null ? "Por determinar" : money(Math.abs(balance))}</strong></div>
            </div>
            {state.error && <p className="form-alert error" role="alert">{state.error}</p>}
            <FleetConflictWarning conflicts={state.conflicts} confirmation={state.confirmation} />
            <button className="button" type="submit" disabled={savingAssignments}>{pending ? "Guardando…" : "Guardar viaje"}</button>
          </aside>
        </div>
      </fieldset>
    </form>
  );
}
