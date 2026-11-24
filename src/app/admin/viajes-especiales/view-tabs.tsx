"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { specialTripsViewHref, type SpecialTripsView } from "./view";

const tabs = { calendario: "Calendario semanal", listado: "Listado" } as const;

export function SpecialTripsViewTabs({ active }: { active: SpecialTripsView | "dia" }) {
  const params = useSearchParams();
  return (
    <nav className="vesp-vistas" aria-label="Vistas de viajes especiales">
      {active === "dia" ? <span className="dia-chip activo" aria-current="page">Día</span> : null}
      {(Object.keys(tabs) as SpecialTripsView[]).map((view) => view === active ? (
        <span key={view} className="dia-chip activo" aria-current="page">{tabs[view]}</span>
      ) : (
        <Link key={view} className="dia-chip" href={specialTripsViewHref(view, (key) => params.get(key))}>
          {tabs[view]}
        </Link>
      ))}
    </nav>
  );
}
