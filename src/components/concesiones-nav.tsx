import Link from "next/link";
import { SCHOOL_RUN_KINDS, type SchoolRunKind } from "@/lib/school-runs/kinds";
import "./concesiones-nav.css";

type ConcesionesNavProps = {
  actual: SchoolRunKind | "todos";
  /** Mantiene el día elegido al cambiar de pestaña. */
  fecha?: string;
  /** Si está, las pestañas apuntan a la vista semanal. */
  semana?: string;
};

function conPeriodo(href: string, fecha?: string, semana?: string) {
  const periodo = semana ? `semana=${encodeURIComponent(semana)}` : fecha ? `fecha=${encodeURIComponent(fecha)}` : "";
  if (!periodo) return href;
  return `${href}${href.includes("?") ? "&" : "?"}${periodo}`;
}

/** Servicios recurrentes: escuelas, personal de aeropuerto y otros. */
export function ConcesionesNav({ actual, fecha, semana }: ConcesionesNavProps) {
  const base = semana ? "/admin/escolares/semana" : "/admin/escolares";
  const secciones = [
    { id: "todos", label: "Todos", href: base },
    ...SCHOOL_RUN_KINDS.map((kind) => ({
      id: kind.value,
      label: kind.tabLabel,
      href: `${base}?tipo=${kind.value}`
    }))
  ] as const;
  return (
    <nav className="cn-modulo-nav" aria-label="Concesiones">
      {secciones.map((seccion) => (
        <Link
          key={seccion.id}
          href={conPeriodo(seccion.href, fecha, semana)}
          aria-current={actual === seccion.id ? "page" : undefined}
        >
          {seccion.label}
        </Link>
      ))}
    </nav>
  );
}
