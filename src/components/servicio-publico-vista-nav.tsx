import Link from "next/link";
import type { TerminalClave } from "@/lib/public-service/board";
import "./servicio-publico-vista-nav.css";

type ServicioPublicoVistaNavProps = {
  actual: "dia" | "semana";
  fecha: string;
  semana: string;
  terminal: TerminalClave | null;
};

function href(base: string, periodo: "fecha" | "semana", valor: string, terminal: TerminalClave | null) {
  const params = new URLSearchParams();
  params.set(periodo, valor);
  if (terminal) params.set("terminal", terminal);
  return `${base}?${params.toString()}`;
}

/** Cambia entre el tablero del día y la planilla semanal de Servicio público. */
export function ServicioPublicoVistaNav({ actual, fecha, semana, terminal }: ServicioPublicoVistaNavProps) {
  return (
    <nav className="sp-vista-nav" aria-label="Vista de Servicio público">
      <Link href={href("/admin/servicio-publico", "fecha", fecha, terminal)} aria-current={actual === "dia" ? "page" : undefined}>Día</Link>
      <Link href={href("/admin/servicio-publico/semana", "semana", semana, terminal)} aria-current={actual === "semana" ? "page" : undefined}>Semana</Link>
    </nav>
  );
}
