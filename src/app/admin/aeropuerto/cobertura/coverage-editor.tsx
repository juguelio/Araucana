"use client";

import { useActionState, useState } from "react";
import { AirportPickupZoneMap } from "@/components/airport-pickup-zone-map";
import type { AirportCoverage, PickupPoint } from "@/lib/airport/pickup-zone";
import { initialAdminFormState } from "../../form-state";
import { saveCoverageAction } from "./actions";

type Ring = number | "extra";

export function CoverageEditor({ initialCoverage }: { initialCoverage: AirportCoverage }) {
  const [coverage, setCoverage] = useState(initialCoverage);
  const [selectedRing, setSelectedRing] = useState<Ring>(0);
  const [result, save, pending] = useActionState(saveCoverageAction, initialAdminFormState);
  const ring = selectedRing === "extra" ? coverage.extraBoundary ?? [] : selectedRing === 0 ? coverage.boundary : coverage.exclusions[selectedRing - 1];

  function editRing(edit: (points: PickupPoint[]) => PickupPoint[]) {
    setCoverage((current) => selectedRing === "extra"
      ? { ...current, extraBoundary: edit(current.extraBoundary ?? []) }
      : selectedRing === 0
        ? { ...current, boundary: edit(current.boundary) }
        : { ...current, exclusions: current.exclusions.map((points, i) => i === selectedRing - 1 ? edit(points) : points) });
  }

  return (
    <form action={save}>
      <h2>Zona de servicio</h2>
      <p className="muted">El verde indica dónde buscamos y dejamos pasajeros en los traslados hacia y desde el aeropuerto. El naranja es el segundo límite: lo que queda dentro de él pero fuera del verde se atiende con el recargo de zona. Dibujá un sector excluido a partir de cada corte rojo donde haga falta. Los trazos rojos discontinuos del mapa original sirven de referencia.</p>
      <div className="form-actions">
        <label>Contorno a editar
          <select value={String(selectedRing)} onChange={(event) => setSelectedRing(event.target.value === "extra" ? "extra" : Number(event.target.value))}>
            <option value={0}>Perímetro de cobertura</option>
            <option value="extra">Perímetro con recargo</option>
            {coverage.exclusions.map((_, i) => <option key={i} value={i + 1}>Sector excluido {i + 1}</option>)}
          </select>
        </label>
        <button className="ghost-button" type="button" disabled={coverage.exclusions.length >= 25} onClick={() => {
          setSelectedRing(coverage.exclusions.length + 1);
          setCoverage((current) => ({ ...current, exclusions: [...current.exclusions, []] }));
        }}>Agregar sector excluido</button>
      </div>
      <AirportPickupZoneMap selectedRing={selectedRing} coverage={coverage} point={null}
        onSelect={(point) => editRing((points) => points.length < 250 ? [...points, point] : points)}
        onMoveVertex={(index, point) => editRing((points) => points.map((previous, i) => i === index ? point : previous))} />
      <div className="form-actions">
        <button className="ghost-button" type="button" disabled={!ring.length} onClick={() => editRing((points) => points.slice(0, -1))}>Deshacer último punto</button>
        <button className="ghost-button" type="button" disabled={!ring.length} onClick={() => editRing(() => [])}>
          {selectedRing === "extra" ? "Borrar zona con recargo" : "Redibujar contorno"}
        </button>
        {typeof selectedRing === "number" && selectedRing > 0 ? <button className="ghost-button" type="button" onClick={() => {
          setCoverage((current) => ({ ...current, exclusions: current.exclusions.filter((_, i) => i !== selectedRing - 1) }));
          setSelectedRing(0);
        }}>Quitar sector</button> : null}
      </div>
      <input type="hidden" name="coverage" value={JSON.stringify(coverage)} />
      <div className="form-actions">
        <label><input type="checkbox" checked={coverage.enabled} onChange={(event) => setCoverage({ ...coverage, enabled: event.target.checked })} /> Aplicar este mapa a las reservas</label>
        <button className="button" type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar mapa"}</button>
      </div>
      {result.message ? <p role="status" className={result.status === "error" ? "field-error" : "muted"}>{result.message}</p> : null}
    </form>
  );
}
