"use client";

import "@/components/modulo/modulo.css";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FleetConflictWarning } from "../fleet-assignment-form";
import { asignarNavesPendientes } from "./asignar-naves";
import { ocupacionDelViaje } from "@/lib/special-trips/rango";
import "./naves-pendientes.css";

type Option = { id: string; name: string };
type Props = {
  id: string; version: string; client: string; start: string; end: string; label: string; tone: string; vehicles: Option[]; drivers: Option[];
  /** El botón común de los módulos («Asignar nave y chofer»), en vez de la pastilla de estado del listado. */
  boton?: boolean;
};

export function NavesPendientes(props: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={props.boton ? "ghost-button modulo-asignar" : "pill pill-estado trip-assign-trigger"} data-tono={props.boton ? undefined : props.tone}
      aria-haspopup="dialog" title="Asignar naves y choferes" onClick={() => setOpen(true)}>{props.label}</button>
    {open && <AssignmentDialog {...props} close={() => setOpen(false)} />}
  </>;
}

function AssignmentDialog({ id, version, client, start, end, vehicles, drivers, close }: Props & { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const next = useRef(1);
  const [rows, setRows] = useState([0]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof asignarNavesPendientes>>>({});
  const range = ocupacionDelViaje(start, end);
  const router = useRouter();
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={dialog} className="trip-assign-dialog plain-card" aria-label={`Asignar naves a ${client}`}
    onCancel={event => { event.preventDefault(); if (!saving) close(); }}>
    <h2>Asignar naves y choferes</h2><p>{client}</p>
    <form onSubmit={async event => {
      event.preventDefault();
      if (saving) return;
      const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
      const items = rows.map(key => ({
        vehicleId: data.get("vehicle-" + key), driverId: data.get("driver-" + key),
        start: data.get("start-" + key), end: data.get("end-" + key)
      }));
      setSaving(true);
      try {
        const response = await asignarNavesPendientes(id, version, items, String(data.get("confirmation") ?? ""));
        if (response.ok) { close(); router.refresh(); } else setResult(response);
      } catch { setResult({ error: "No se pudo guardar. Revisá el listado antes de reintentar." }); }
      finally { setSaving(false); }
    }}>
      <fieldset disabled={saving} className="trip-assign-fields">
        {rows.map((key, i) => <fieldset key={key} className="admin-form-grid"><legend>Unidad {i + 1}</legend>
          <label className="span-2">Nave<select name={"vehicle-" + key} required defaultValue=""><option value="">Elegí una nave</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
          <label className="span-2">Chofer<select name={"driver-" + key} defaultValue=""><option value="">Sin asignar</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label className="span-2">Desde<input type="datetime-local" name={"start-" + key} defaultValue={range.start} required /></label>
          <label className="span-2">Hasta<input type="datetime-local" name={"end-" + key} defaultValue={range.end} required /></label>
          {rows.length > 1 && <button type="button" className="table-link" onClick={() => setRows(rows.filter(row => row !== key))}>Quitar unidad {i + 1}</button>}
        </fieldset>)}
        {rows.length < 50 && <button type="button" className="ghost-button" onClick={() => setRows([...rows, next.current++])}>Agregar otra nave</button>}
        {result.error && <p role="alert">{result.error}</p>}
        <FleetConflictWarning conflicts={result.conflicts} confirmation={result.confirmation} />
        <div className="inline-actions"><button className="button">{saving ? "Guardando…" : "Guardar asignaciones"}</button><button type="button" className="ghost-button" onClick={close}>Cancelar</button></div>
      </fieldset>
    </form>
  </dialog>;
}
