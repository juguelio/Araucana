import Link from "next/link";
import type { ReactNode } from "react";
import "./modulo.css";

/**
 * El patrón común de los módulos de servicios (24-nov, pedido de Jugue: «que se homogeneicen… el
 * módulo base es Aeropuerto»). Servicio público, Viajes especiales y Concesiones arman la pantalla con
 * las mismas piezas que Aeropuerto, en el mismo orden y con los mismos nombres. Aeropuerto es el
 * modelo y no usa estos componentes ni se toca («no toque nada de aeropuerto»): las piezas copian su
 * marcado y sus clases.
 *
 * 1. Cabecera (`AdminShell`): rótulo «Servicios»; a la derecha los secundarios (borde) y al final el
 *    principal (relleno).
 * 2. `SelectorDeVista`: Semana · Día (· Listado), siempre en el mismo lugar, debajo de las pestañas.
 * 3. `BarraDelDia`: ‹ Anterior · DÍA [fecha] Ver · Siguiente ›, con los filtros a la derecha. En la
 *    semana, `WeeklyCalendar` trae la misma barra con «Semana».
 * 4. `Cifras`: rótulo en mayúsculas arriba, número abajo; en color las que piden atención.
 * 5. `ChipsDeFiltro`: «Todos 11 · Con imprevisto 0».
 * 6. Asignar: «Asignar nave y chofer» si falta, «Cambiar nave y chofer» si ya está (`textoDeAsignar`).
 *
 * Reusa las clases de Aeropuerto (`flights-*`); lo propio del patrón va en `modulo.css`, bajo `modulo-*`.
 */

export const ROTULO_DE_SERVICIOS = "Servicios";

export function textoDeAsignar(completo: boolean) {
  return completo ? "Cambiar nave y chofer" : "Asignar nave y chofer";
}

export type OpcionDeVista = { id: string; etiqueta: string; href: string };

export function SelectorDeVista({ opciones, actual }: { opciones: OpcionDeVista[]; actual: string }) {
  return (
    <nav className="flights-filters modulo-filtros modulo-vistas" aria-label="Vista">
      {opciones.map((opcion) => (
        <Link key={opcion.id} href={opcion.href} data-active={opcion.id === actual} aria-current={opcion.id === actual ? "page" : undefined}>
          {opcion.etiqueta}
        </Link>
      ))}
    </nav>
  );
}

/** Las vistas de un módulo con semana y día (y, en Viajes especiales, listado). */
export function vistasDeModulo(semana: string, dia: string, listado?: string): OpcionDeVista[] {
  return [
    { id: "semana", etiqueta: "Semana", href: semana },
    { id: "dia", etiqueta: "Día", href: dia },
    ...(listado ? [{ id: "listado", etiqueta: "Listado", href: listado }] : [])
  ];
}

export function BarraDelDia({
  accion,
  nombre = "date",
  fecha,
  anterior,
  siguiente,
  ocultos = {},
  children
}: {
  /** Adónde va el formulario «Ver». */
  accion: string;
  /** El parámetro de la fecha: `date` en Aeropuerto, `fecha` en los demás. */
  nombre?: string;
  fecha: string;
  anterior: string;
  siguiente: string;
  /** Los demás parámetros que se conservan al elegir otra fecha (vista, terminal, tipo…). */
  ocultos?: Record<string, string | null | undefined>;
  /** Lo que va a la derecha: los chips de filtro. */
  children?: ReactNode;
}) {
  return (
    <section className="flights-toolbar modulo-barra">
      {/* Siempre las dos flechas, para ir de un día al otro sin volver a «hoy». */}
      <form className="flights-date" method="get" action={accion}>
        <Link className="ghost-button flights-dia-paso" href={anterior} aria-label="Día anterior">‹ Anterior</Link>
        <label>
          Día
          <input type="date" name={nombre} defaultValue={fecha} />
        </label>
        {Object.entries(ocultos).map(([clave, valor]) => (valor ? <input key={clave} type="hidden" name={clave} value={valor} /> : null))}
        <button className="button" type="submit">Ver</button>
        <Link className="ghost-button flights-dia-paso" href={siguiente} aria-label="Día siguiente">Siguiente ›</Link>
      </form>
      {children ? <div className="modulo-barra-derecha">{children}</div> : null}
    </section>
  );
}

export type Cifra = { rotulo: string; valor: number | string; alerta?: boolean; href?: string };

export function Cifras({ cifras, etiqueta = "Resumen del día" }: { cifras: Cifra[]; etiqueta?: string }) {
  return (
    <dl className="flights-summary modulo-cifras" aria-label={etiqueta} style={{ gridTemplateColumns: `repeat(${cifras.length}, minmax(0, 1fr))` }}>
      {cifras.map((cifra) => (
        <div key={cifra.rotulo} data-alerta={Boolean(cifra.alerta)}>
          <dt>{cifra.rotulo}</dt>
          <dd>{cifra.href ? <Link href={cifra.href}>{cifra.valor}</Link> : cifra.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

export type Filtro = { id: string; etiqueta: string; cuenta?: number; href: string };

export function ChipsDeFiltro({ filtros, actual, etiqueta = "Filtrar" }: { filtros: Filtro[]; actual: string; etiqueta?: string }) {
  return (
    <nav className="flights-filters modulo-filtros" aria-label={etiqueta}>
      {filtros.map((filtro) => (
        <Link key={filtro.id} href={filtro.href} data-active={filtro.id === actual} aria-current={filtro.id === actual ? "page" : undefined}>
          {filtro.etiqueta}{filtro.cuenta !== undefined ? <> <span>{filtro.cuenta}</span></> : null}
        </Link>
      ))}
    </nav>
  );
}

/**
 * La barra de la semana para las vistas que no usan `WeeklyCalendar` (Concesiones «por chofer»): el
 * mismo aspecto que la del calendario, ‹ Anterior · SEMANA [fecha] Ver · Siguiente › · Esta semana.
 */
export function BarraDeSemana({
  accion,
  lunes,
  rango,
  anterior,
  siguiente,
  estaSemana,
  ocultos = {},
  children
}: {
  accion: string;
  lunes: string;
  /** «23 nov al 29 nov». */
  rango: string;
  anterior: string;
  siguiente: string;
  /** Si la semana no es la actual, el enlace a la actual. */
  estaSemana?: string | null;
  ocultos?: Record<string, string | null | undefined>;
  children?: ReactNode;
}) {
  return (
    <section className="flights-toolbar modulo-barra">
      <form className="flights-date" method="get" action={accion}>
        <Link className="ghost-button flights-dia-paso" href={anterior} aria-label="Semana anterior">‹ Anterior</Link>
        <label>
          Semana
          <input type="date" name="semana" defaultValue={lunes} />
        </label>
        {Object.entries(ocultos).map(([clave, valor]) => (valor ? <input key={clave} type="hidden" name={clave} value={valor} /> : null))}
        <button className="button" type="submit">Ver</button>
        <strong className="modulo-rango">{rango}</strong>
        <Link className="ghost-button flights-dia-paso" href={siguiente} aria-label="Semana siguiente">Siguiente ›</Link>
        {estaSemana ? <Link className="ghost-button flights-dia-paso" href={estaSemana}>Esta semana</Link> : null}
      </form>
      {children ? <div className="modulo-barra-derecha">{children}</div> : null}
    </section>
  );
}
