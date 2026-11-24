import Link from "next/link";
import type { SchoolRunKind } from "@/lib/school-runs/kinds";
import "./concesiones-nav.css";

type ConcesionesVistaNavProps = {
  actual: "dia" | "semana";
  tipo: SchoolRunKind | null;
  fecha: string;
  semana: string;
};

function conParametros(base: string, tipo: SchoolRunKind | null, periodo: "fecha" | "semana", valor: string) {
  const params = new URLSearchParams();
  if (tipo) params.set("tipo", tipo);
  params.set(periodo, valor);
  return `${base}?${params.toString()}`;
}

/** Cambia entre la vista de un día y la planilla de los siete días. */
export function ConcesionesVistaNav({ actual, tipo, fecha, semana }: ConcesionesVistaNavProps) {
  const dia = conParametros("/admin/escolares", tipo, "fecha", fecha);
  const planilla = conParametros("/admin/escolares/semana", tipo, "semana", semana);
  return (
    <nav className="cn-vista-nav" aria-label="Vista de Concesiones">
      <Link href={dia} aria-current={actual === "dia" ? "page" : undefined}>Día</Link>
      <Link href={planilla} aria-current={actual === "semana" ? "page" : undefined}>Semana</Link>
    </nav>
  );
}
