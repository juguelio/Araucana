import Link from "next/link";
import { SCHOOL_RUN_KINDS, type SchoolRunKind } from "@/lib/school-runs/kinds";
import "./concesiones-nav.css";

type ConcesionesNavProps = {
  actual: SchoolRunKind | "todos";
  /** Mantiene el día elegido al cambiar de pestaña. */
  fecha?: string;
};

const SECCIONES = [
  { id: "todos", label: "Todos", href: "/admin/escolares" },
  ...SCHOOL_RUN_KINDS.map((kind) => ({
    id: kind.value,
    label: kind.tabLabel,
    href: `/admin/escolares?tipo=${kind.value}`
  }))
] as const;

function conFecha(href: string, fecha?: string) {
  if (!fecha) return href;
  return `${href}${href.includes("?") ? "&" : "?"}fecha=${encodeURIComponent(fecha)}`;
}

/** Servicios recurrentes: escuelas, personal de aeropuerto y otros. */
export function ConcesionesNav({ actual, fecha }: ConcesionesNavProps) {
  return (
    <nav className="cn-modulo-nav" aria-label="Concesiones">
      {SECCIONES.map((seccion) => (
        <Link
          key={seccion.id}
          href={conFecha(seccion.href, fecha)}
          aria-current={actual === seccion.id ? "page" : undefined}
        >
          {seccion.label}
        </Link>
      ))}
    </nav>
  );
}
