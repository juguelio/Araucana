import Link from "next/link";
import "./service-public-nav.css";

type ServicePublicNavProps = {
  actual: "boleteria" | "rutas";
  /** La secretaría vende pasajes pero no administra rutas: no le mostramos una pestaña que la va a rebotar. */
  mostrarRutas?: boolean;
};

const SECCIONES = [
  { id: "boleteria", href: "/admin/servicio-publico", label: "Boletería" },
  { id: "rutas", href: "/admin/rutas", label: "Rutas" }
] as const;

/** Las dos pantallas del módulo Servicio público: la boletería del día y la administración de rutas. */
export function ServicePublicNav({ actual, mostrarRutas = true }: ServicePublicNavProps) {
  return (
    <nav className="sp-modulo-nav" aria-label="Servicio público">
      {SECCIONES.filter((seccion) => seccion.id !== "rutas" || mostrarRutas).map((seccion) => (
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
