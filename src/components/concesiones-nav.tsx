import Link from "next/link";
import "./concesiones-nav.css";

type ConcesionesNavProps = {
  actual: "escolares" | "aeropuerto";
};

const SECCIONES = [
  { id: "escolares", href: "/admin/escolares", label: "Escolares" },
  { id: "aeropuerto", href: "/admin/aeropuerto", label: "Aeropuerto" }
] as const;

/** Las concesiones son los servicios recurrentes: escuelas y traslados de aeropuerto. */
export function ConcesionesNav({ actual }: ConcesionesNavProps) {
  return (
    <nav className="cn-modulo-nav" aria-label="Concesiones">
      {SECCIONES.map((seccion) => (
        <Link
          key={seccion.id}
          href={seccion.href}
          aria-current={actual === seccion.id ? "page" : undefined}
        >
          {seccion.label}
        </Link>
      ))}
    </nav>
  );
}
