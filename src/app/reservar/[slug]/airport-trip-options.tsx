"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/** Las tres formas de reservar el aeropuerto, en el mismo orden y con el mismo aspecto en todas partes. */
export type OpcionDeViaje = "ARRIVAL" | "DEPARTURE" | "ROUND_TRIP";

type Tarifa = { priceCents: number; currency: string } | null | undefined;

const OPCIONES: Array<{ code: OpcionDeViaje; title: string; subtitle: string; ayuda: string }> = [
  {
    code: "ARRIVAL",
    title: "Llegada a Chapelco",
    subtitle: "Aeropuerto Chapelco (CPC) → San Martín de los Andes",
    ayuda: "Me espera una combi cuando aterrizo."
  },
  {
    code: "DEPARTURE",
    title: "Salida desde San Martín",
    subtitle: "San Martín de los Andes → Aeropuerto Chapelco (CPC)",
    ayuda: "Me pasan a buscar para tomar mi vuelo."
  },
  {
    code: "ROUND_TRIP",
    title: "Ida y vuelta",
    subtitle: "San Martín de los Andes ⇄ Aeropuerto Chapelco (CPC)",
    ayuda: "Elegís el vuelo de llegada y el de salida, con los datos cargados una sola vez"
  }
];

function precio(cents: number, currency: string) {
  if (cents <= 0) return "Consultar";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

type AirportTripOptionsProps = {
  fares: { ARRIVAL?: Tarifa; DEPARTURE?: Tarifa };
  selected: OpcionDeViaje | null;
  /**
   * Cómo se elige cada opción: con `onSelect` es un botón (cambia el paso dentro del mismo formulario);
   * si no, un link a la pantalla de esa opción (`hrefs`).
   */
  onSelect?: Partial<Record<OpcionDeViaje, () => void>>;
  hrefs?: Partial<Record<OpcionDeViaje, string>>;
};

/**
 * «¿Llegás o te vas?»: llegada, salida o ida y vuelta. Es el mismo bloque en la reserva web de un tramo,
 * en la de ida y vuelta y en el alta del panel, para que el criterio visual sea uno solo.
 */
export function AirportTripOptions({ fares, selected, onSelect = {}, hrefs = {} }: AirportTripOptionsProps) {
  return (
    <div className="wizard-options">
      {OPCIONES.map((opcion) => {
        const tarifa =
          opcion.code === "ROUND_TRIP"
            ? fares.ARRIVAL && fares.DEPARTURE
              ? { priceCents: fares.ARRIVAL.priceCents + fares.DEPARTURE.priceCents, currency: fares.ARRIVAL.currency }
              : null
            : fares[opcion.code];
        const contenido = (
          <>
            <b>
              {opcion.title}
              {opcion.code === "ROUND_TRIP" ? <span className="wizard-option-badge">2 tramos</span> : null}
            </b>
            <span className="wizard-option-route">{opcion.subtitle}</span>
            <span className="muted">
              {tarifa ? `${opcion.ayuda} · ${precio(tarifa.priceCents, tarifa.currency)} por persona` : "Sin tarifa activa para esta opción."}
            </span>
          </>
        );
        const clase = `wizard-option${opcion.code === "ROUND_TRIP" ? " wizard-option-round-trip" : ""}`;
        const elegir = onSelect[opcion.code];
        const href = hrefs[opcion.code];

        if (!tarifa || (!elegir && !href) || selected === opcion.code) {
          return (
            <button
              key={opcion.code}
              type="button"
              className={clase}
              data-selected={selected === opcion.code}
              aria-pressed={selected === opcion.code}
              disabled={!tarifa}
              onClick={elegir}
            >
              {contenido}
            </button>
          );
        }
        if (elegir) {
          return (
            <button key={opcion.code} type="button" className={clase} data-selected={false} aria-pressed={false} onClick={elegir}>
              {contenido}
            </button>
          );
        }
        return (
          <Link key={opcion.code} className={clase} href={href!}>
            {contenido}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * «¿Ida y vuelta?» debajo de la barra (pedido de Jugue, 18-nov): la reserva de un tramo y la de ida y
 * vuelta son el mismo recuadro; este interruptor suma o saca la vuelta. Navega a la otra pantalla
 * llevando el día, el sentido y el vuelo ya elegidos, para no empezar de cero.
 */
export function IdaYVueltaToggle({ activo, href, sentido, fares }: {
  /** true en la pantalla de ida y vuelta. */
  activo: boolean;
  /** A dónde lleva el toque (con los parámetros ya armados). */
  href: string;
  /** El sentido del primer tramo: define qué se suma o qué queda. */
  sentido: "ARRIVAL" | "DEPARTURE";
  fares: { ARRIVAL?: Tarifa; DEPARTURE?: Tarifa };
}) {
  const router = useRouter();
  const otro = sentido === "ARRIVAL" ? "DEPARTURE" : "ARRIVAL";
  const tarifaOtro = fares[otro];
  // Sin tarifa activa para el otro sentido no hay ida y vuelta que ofrecer.
  if (!activo && !tarifaOtro) return null;
  const nombreOtro = otro === "ARRIVAL" ? "la llegada a Chapelco" : "la salida desde San Martín";
  const nombrePropio = sentido === "ARRIVAL" ? "la llegada" : "la salida";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      className="round-trip-toggle"
      data-activo={activo || undefined}
      onClick={() => router.push(href, { scroll: false })}
    >
      <span className="round-trip-toggle-box" aria-hidden="true">{activo ? "✓" : ""}</span>
      <span className="round-trip-toggle-text">
        <b>{activo ? "Ida y vuelta" : "¿Ida y vuelta?"}</b>
        <small>
          {activo
            ? `Son dos tramos. Destildalo para reservar sólo ${nombrePropio}.`
            : `Sumá la vuelta: ${nombreOtro}${tarifaOtro ? `, ${precio(tarifaOtro.priceCents, tarifaOtro.currency)} más por persona` : ""}.`}
        </small>
      </span>
    </button>
  );
}

/** Arma el link de la otra pantalla conservando lo elegido: `base` es el href de esa pantalla. */
export function hrefConViaje(base: string, datos: { date: string; sentido: "ARRIVAL" | "DEPARTURE"; vuelo?: string }) {
  const url = new URL(base, "http://x");
  url.searchParams.set("date", datos.date);
  url.searchParams.set("sentido", datos.sentido);
  if (datos.vuelo) url.searchParams.set("vuelo", datos.vuelo);
  else url.searchParams.delete("vuelo");
  return `${url.pathname}?${url.searchParams.toString()}`;
}
