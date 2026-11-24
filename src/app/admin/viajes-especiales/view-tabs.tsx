"use client";

import { useSearchParams } from "next/navigation";
import { SelectorDeVista, vistasDeModulo } from "@/components/modulo/modulo";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { specialTripsPath, specialTripsViewHref, type SpecialTripsView } from "./view";

/**
 * Semana · Día · Listado: el selector común de los módulos de servicios (24-nov), en el mismo lugar
 * que en Servicio público y Concesiones. La semana y el listado conservan los filtros.
 */
export function SpecialTripsViewTabs({ active, fecha }: { active: SpecialTripsView | "dia"; fecha?: string }) {
  const params = useSearchParams();
  const get = (key: string) => params.get(key);
  const semana = specialTripsViewHref("calendario", get);
  const dia = `${specialTripsPath}/dia?fecha=${fecha ?? argentinaDateKey()}`;
  return (
    <SelectorDeVista
      actual={active === "calendario" ? "semana" : active}
      opciones={vistasDeModulo(semana, dia, specialTripsViewHref("listado", get))}
    />
  );
}
