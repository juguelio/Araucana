import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { complianceLabel, peorVencimiento } from "@/lib/vehicles/compliance";
import "../naves.css";
import "./ficha.css";

/**
 * Lo común a todas las pantallas de una nave: cargar la unidad, su encabezado y el menú para
 * moverse entre la ficha y sus secciones (recorridos, vencimientos, daños, reparaciones).
 * Cada página dibuja su propio `AdminShell`, así que esto es un componente y no un layout.
 */

export const TIPO_LABEL: Record<string, string> = { CAMIONETA: "Camioneta", BUS: "Bus", UTILITARIO: "Utilitario" };

export type SeccionDeNave = "resumen" | "recorridos" | "vencimientos" | "danios" | "service" | "reparaciones" | "editar";

const SECCIONES: Array<{ seccion: SeccionDeNave; label: string; path: string }> = [
  { seccion: "resumen", label: "Ficha", path: "" },
  { seccion: "recorridos", label: "Recorridos", path: "/recorridos" },
  { seccion: "vencimientos", label: "Vencimientos y seguro", path: "/vencimientos" },
  { seccion: "danios", label: "Daños", path: "/danios" },
  { seccion: "service", label: "Service", path: "/service" },
  { seccion: "reparaciones", label: "Reparaciones", path: "/reparaciones" },
  { seccion: "editar", label: "Editar", path: "/editar" }
];

export function hrefDeNave(id: string, seccion: SeccionDeNave = "resumen") {
  return `/admin/naves/${id}${SECCIONES.find((s) => s.seccion === seccion)?.path ?? ""}`;
}

/** La nave con lo que muestra el encabezado. 404 si no existe. */
export async function cargarNave(id: string) {
  const nave = await prisma.vehicle.findUnique({
    where: { id },
    include: { _count: { select: { seats: true } } }
  });
  if (!nave) notFound();
  return nave;
}

export type NaveDeFicha = Awaited<ReturnType<typeof cargarNave>>;

export function nombreDeNave(nave: { internalNumber: string | null; name: string }) {
  return nave.internalNumber ? `Interno ${nave.internalNumber}` : nave.name;
}

/** Encabezado de la nave + menú de secciones. `seccion` marca la pantalla actual. */
export function CabeceraDeNave({ nave, seccion, hoy = new Date() }: { nave: NaveDeFicha; seccion: SeccionDeNave; hoy?: Date }) {
  const peor = peorVencimiento(nave, hoy);
  return (
    <>
      <p className="nave-volver">
        <Link href="/admin/naves">← Todas las naves</Link>
      </p>
      <header className="plain-card nave-cabecera" data-nivel={peor?.level ?? undefined}>
        <div className="nave-cabecera-titulo">
          <h2>{nombreDeNave(nave)}</h2>
          <span className={`status-pill ${nave.isActive ? "active" : "inactive"}`}>{nave.isActive ? "Activa" : "Inactiva"}</span>
          {nave.publicTransport ? (
            <span className="pill pill-estado" data-tono="ok">transporte público</span>
          ) : null}
        </div>
        <dl className="nave-datos">
          {nave.internalNumber ? (
            <div><dt>Nombre</dt><dd>{nave.name}</dd></div>
          ) : null}
          <div><dt>Tipo</dt><dd>{TIPO_LABEL[nave.kind] ?? nave.kind}</dd></div>
          <div><dt>Marca / modelo</dt><dd>{nave.brand} · {nave.model}</dd></div>
          <div><dt>Patente</dt><dd>{nave.licensePlate ?? "sin patente"}</dd></div>
          <div><dt>Año</dt><dd>{nave.year ?? "—"}</dd></div>
          <div><dt>Capacidad</dt><dd>{nave._count.seats ? `${nave._count.seats} pasajeros` : "sin plano de butacas"}</dd></div>
          <div><dt>Titular</dt><dd>{nave.owner ?? "—"}</dd></div>
          <div>
            <dt>Papeles</dt>
            <dd className="nave-papel" data-nivel={peor?.level ?? undefined}>
              {peor ? `${peor.tipo}: ${complianceLabel(peor.fecha, hoy)}` : "sin fechas cargadas"}
            </dd>
          </div>
        </dl>
      </header>
      <nav className="nave-menu" aria-label="Secciones de la nave">
        {SECCIONES.map((s) => (
          <Link key={s.seccion} href={hrefDeNave(nave.id, s.seccion)} aria-current={s.seccion === seccion ? "page" : undefined}>
            {s.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

/** «Sin datos todavía» con una explicación de cómo se cargan. */
export function SinDatos({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <div className="nave-vacio">
      <strong>{titulo}</strong>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  );
}

/** dd/mm/aaaa hh:mm en hora de Argentina (los servicios se programan en hora local). */
export function fechaHora(fecha: Date) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(fecha);
}

/** dd/mm/aaaa en hora de Argentina. */
export function fechaCorta(fecha: Date) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(fecha);
}

/** Fecha de un recorrido: los de día entero (Chapelco) se guardan a medianoche UTC y no tienen hora. */
export function fechaDeRecorrido(recorrido: { desde: Date; hasta: Date | null; soloDia: boolean }) {
  return recorrido.soloDia ? diaUtc(recorrido.desde) : fechaHora(recorrido.desde);
}

/** dd/mm/aaaa de una fecha guardada como día a medianoche UTC (egresos de contabilidad, días de Chapelco). */
export function diaUtc(fecha: Date) {
  const [anio, mes, dia] = fecha.toISOString().slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}
