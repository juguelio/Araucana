import Link from "next/link";
import { etiquetaDeConcesion } from "@/lib/school-runs/kinds";
import { leerTurno } from "@/lib/school-runs/dia";

export type ServicioDeCalendario = {
  id: string;
  kind: string;
  routeName: string;
  shift: string;
  companion: string | null;
  chofer: string | null;
  nave: string | null;
};

const diaLargo = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const diaCorto = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const mesCorto = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
const fechaDe = (dia: string) => new Date(`${dia}T12:00:00.000Z`);

/**
 * El calendario semanal de Concesiones: siete columnas, una por día, con sus servicios. Lo usan la
 * vista Semana (completo) y la vista del día (compacto, con el día elegido marcado y cada servicio en
 * un renglón), para que al trabajar un día no se pierda la semana de vista (pedido de Jugue, 24-nov).
 */
export function CalendarioSemana({
  dias,
  hoy,
  porDia,
  hrefDia,
  hrefNuevo,
  hrefServicio,
  seleccionado,
  compacto = false,
  etiqueta
}: {
  dias: string[];
  hoy: string;
  porDia: Map<string, ServicioDeCalendario[]>;
  hrefDia: (fecha: string, kind?: string) => string;
  hrefNuevo: (fecha: string) => string;
  /** Adónde lleva un servicio. Por defecto, al día de ese servicio. */
  hrefServicio?: (fecha: string, servicio: ServicioDeCalendario) => string;
  /** El día que se está mirando (vista del día). */
  seleccionado?: string;
  compacto?: boolean;
  etiqueta: string;
}) {
  return (
    <section className={`cn-semana${compacto ? " cn-semana-compacta" : ""}`} aria-label={etiqueta}>
      <div className="cn-semana-scroll">
        <div className="cn-semana-grid">
          {dias.map((dia) => {
            const delDia = porDia.get(dia) ?? [];
            const fecha = fechaDe(dia);
            const faltan = delDia.filter((servicio) => !servicio.chofer || !servicio.nave).length;
            const servicios = compacto ? [...delDia].sort((a, b) => leerTurno(a.shift).orden - leerTurno(b.shift).orden || a.routeName.localeCompare(b.routeName, "es")) : delDia;
            return (
              <article key={dia} className="cn-semana-dia" data-hoy={dia === hoy} data-actual={dia === seleccionado || undefined}>
                <header>
                  <span>{diaCorto.format(fecha)}</span>
                  <strong>{fecha.getUTCDate()}</strong>
                  <small>{mesCorto.format(fecha)}</small>
                </header>
                <div className="cn-semana-pie cn-semana-pie-top">
                  {dia === seleccionado ? <span className="cn-semana-viendo">Viendo este día</span> : <Link className="cn-semana-ver-dia" href={hrefDia(dia)}>Ver el día →</Link>}
                  <Link className="cn-semana-agregar" href={hrefNuevo(dia)}>+ Agregar</Link>
                </div>
                <p className="muted">
                  {delDia.length ? `${delDia.length} ${delDia.length === 1 ? "servicio" : "servicios"}` : "Sin servicios"}
                  {faltan ? <em className="cn-semana-faltan"> · {faltan} sin asignar</em> : null}
                </p>
                <div className="cn-semana-lista">
                  {servicios.map((servicio) => {
                    const href = hrefServicio ? hrefServicio(dia, servicio) : hrefDia(dia, servicio.kind);
                    const falta = !servicio.chofer || !servicio.nave;
                    return compacto ? (
                      <Link key={servicio.id} className="cn-semana-servicio cn-semana-renglon" href={href} data-falta={falta || undefined}
                        title={`${servicio.shift} · ${servicio.routeName} · ${servicio.chofer ?? "Sin chofer"} · ${servicio.nave ?? "Sin nave"}`}>
                        <b>{leerTurno(servicio.shift).etiqueta}</b> {servicio.routeName}
                      </Link>
                    ) : (
                      <Link key={servicio.id} className="cn-semana-servicio" href={href} title={diaLargo.format(fecha)} data-falta={falta || undefined}>
                        <strong>{servicio.routeName}</strong>
                        <span>{servicio.shift}{servicio.companion ? ` · ${servicio.companion}` : ""}</span>
                        <span className="pill">{etiquetaDeConcesion(servicio.kind)}</span>
                        <span>{servicio.chofer ?? "Sin chofer"} · {servicio.nave ?? "Sin nave"}</span>
                      </Link>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
