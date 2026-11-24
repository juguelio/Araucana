"use client";

import { useCallback, useRef, useState } from "react";
import { localDateTime, argentina, type AssignmentInput } from "@/lib/special-trips/data";
import { ChoferBuscador } from "../aeropuerto/chofer-buscador";
import { NaveBuscador } from "../aeropuerto/nave-buscador";
import { FleetConflictWarning } from "../fleet-assignment-form";
import { RowModal } from "../reservas/row-modal";
import { editarNavesDelViaje } from "./asignar-naves";
import "../aeropuerto/combi-modal.css";

type VehicleOption = { id: string; name: string; internalNumber?: string | null; licensePlate?: string | null };
type DriverOption = { id: string; name: string; email?: string };
type Props = {
  id: string;
  version: string;
  client: string;
  assignments: AssignmentInput[];
  vehicles: VehicleOption[];
  drivers: DriverOption[];
  range: Pick<AssignmentInput, "start" | "end">;
  onSaved: (assignments: AssignmentInput[], version: string) => void;
  disabled?: boolean;
  onSavingChange: (saving: boolean) => void;
  extend?: { days: number; assignments: AssignmentInput[] };
};

const display = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: argentina });
function labelForTime(time: string) {
  const local = localDateTime(time, argentina);
  return local ? display.format(local) : time;
}

export function TripFleetModal({ id, version, client, assignments, vehicles, drivers, range, onSaved, disabled, onSavingChange, extend }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [proposal, setProposal] = useState<AssignmentInput[] | null>(null);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof editarNavesDelViaje>>>({});
  const inFlight = useRef(false);
  const current = editing === null ? undefined : assignments[editing];

  const changeOpen = useCallback((next: boolean) => {
    if (inFlight.current) return;
    setOpen(next);
    if (next) {
      setEditing(null);
      setResult({});
      setProposal(null);
    }
  }, []);

  function edit(index: number | null) {
    setEditing(index);
    setResult({});
    setProposal(null);
    setNotice("");
  }

  async function save(next: AssignmentInput[], confirmation = "") {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    onSavingChange(true);
    setProposal(null);
    setNotice("");
    setResult({});
    try {
      const response = await editarNavesDelViaje(id, version, next, confirmation);
      if (response.ok && response.version) {
        onSaved(next, response.version);
        setEditing(null);
        setNotice("Asignaciones guardadas.");
      } else {
        if (response.conflicts?.length) setProposal(next);
        setResult(response);
      }
    } catch {
      setResult({ error: "No se pudo confirmar el guardado. Revisá las asignaciones antes de reintentar." });
    } finally {
      inFlight.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  }

  return (
    <>
      {assignments.length ? (
        <ul>
          {assignments.map((assignment, index) => (
            <li key={index}>
              <strong>{vehicles.find((option) => option.id === assignment.vehicleId)?.name ?? "Nave"}</strong>
              {" · "}{drivers.find((option) => option.id === assignment.driverId)?.name ?? "Sin chofer"}
              {" · "}{labelForTime(assignment.start)} → {labelForTime(assignment.end)}
            </li>
          ))}
        </ul>
      ) : <p className="muted">Sin naves asignadas.</p>}
      {!open && notice && <p className="muted" role="status">{notice}</p>}
      <RowModal open={open} onOpenChange={changeOpen} triggerDisabled={disabled}
        trigger="Agregar nave" triggerLabel="Agregar nave" triggerClassName="ghost-button" modalClassName="aero-combi-modal"
        eyebrow="Viaje especial" title="Naves y choferes" subtitle={client}>
        <p className="muted">Las asignaciones se guardan en este modal. Los demás cambios se guardan con «Guardar viaje».</p>
        {assignments.length > 0 && (
          <div className="aero-combi-asignadas">
            <strong>Asignadas</strong>
            {assignments.map((assignment, index) => (
              <div className="aero-combi-asignada" key={index}>
                <span>
                  <strong>{vehicles.find((option) => option.id === assignment.vehicleId)?.name ?? "Nave"}</strong>
                  {" · "}{drivers.find((option) => option.id === assignment.driverId)?.name ?? "Sin chofer"}
                  {" · "}{labelForTime(assignment.start)} → {labelForTime(assignment.end)}
                </span>
                <button className="ghost-button" type="button" disabled={saving} onClick={() => edit(index)}>Cambiar</button>
                <button className="ghost-button" type="button" disabled={saving}
                  onClick={() => void save(assignments.filter((_, row) => index !== row))}>Quitar</button>
              </div>
            ))}
          </div>
        )}
        {extend && (
          <div className="inline-actions">
            <button type="button" className="ghost-button" disabled={saving || Boolean(proposal)} onClick={() => void save(extend.assignments)}>
              Ocupar los {extend.days} días
            </button>
          </div>
        )}
        {proposal && (
          <form onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void save(proposal, result.confirmation);
          }}>
            <FleetConflictWarning conflicts={result.conflicts} confirmation={result.confirmation} />
            <button type="button" className="ghost-button" onClick={() => { setProposal(null); setResult({}); }}>Volver a editar</button>
          </form>
        )}
        <form key={`${version}:${editing ?? "new"}`} onSubmit={(event) => {
          event.preventDefault();
          // El modal se renderiza en un portal, pero el submit también burbujea por el árbol de React.
          event.stopPropagation();
          const data = new FormData(event.currentTarget);
          const assignment = {
            vehicleId: String(data.get("vehicleId") ?? ""),
            driverId: String(data.get("driverId") ?? ""),
            start: String(data.get("start") ?? ""),
            end: String(data.get("end") ?? "")
          };
          const next = editing === null ? [...assignments, assignment] : assignments.map((a, index) => index === editing ? assignment : a);
          void save(next);
        }}>
          <fieldset className="inline-actions" disabled={saving || Boolean(proposal)}>
            <div className="aero-combi-columnas">
              <NaveBuscador flightNumber={client} defaultId={current?.vehicleId}
                naves={vehicles.map(({ id, name, internalNumber, licensePlate }) => ({
                  id, name, internalNumber: internalNumber ?? null, licensePlate: licensePlate ?? null
                }))} />
              <ChoferBuscador flightNumber={client} defaultId={current?.driverId}
                choferes={drivers.map(({ id, name, email }) => ({ id, label: name, email: email ?? name }))} />
            </div>
            <div className="admin-form-grid">
              <label>Desde<input name="start" type="datetime-local" defaultValue={current?.start ?? range.start} required /></label>
              <label>Hasta<input name="end" type="datetime-local" defaultValue={current?.end ?? range.end} required /></label>
            </div>
            {result.error && <p className="form-alert error" role="alert">{result.error}</p>}
            <div className="inline-actions">
              <button className="button" type="submit" disabled={editing === null && assignments.length >= 50}>
                {saving ? "Guardando…" : editing !== null ? "Guardar cambios de la nave" : assignments.length ? "Sumar y guardar nave" : "Guardar nave"}
              </button>
              {editing !== null && <button className="ghost-button" type="button" onClick={() => edit(null)}>Cancelar cambio</button>}
              <button className="ghost-button" type="button" onClick={() => changeOpen(false)}>Listo</button>
            </div>
            {notice && <p className="muted" role="status">{notice}</p>}
          </fieldset>
        </form>
      </RowModal>
    </>
  );
}
