import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { listAdminSchedules } from "@/lib/booking/repository";
import { prisma } from "@/lib/db/prisma";
import { isDateKey, shiftDateKey } from "@/lib/operations/day-board";
import { agruparPorTerminal, nombreDeTerminal, resumenDeSalidas, salidasDeTerminal, TERMINALES, type TerminalClave } from "@/lib/public-service/board";
import { DriverPicker } from "./driver-picker";
import "./servicio-publico.css";

export const metadata = { title: "Servicio público · La Araucana" };
export const dynamic = "force-dynamic";

type ServicioPublicoPageProps = {
  searchParams?: Promise<{ fecha?: string; terminal?: string }>;
};

const diaFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "America/Argentina/Salta"
});

function esTerminal(valor?: string): valor is TerminalClave {
  return TERMINALES.some((terminal) => terminal.clave === valor);
}

function etiquetaDia(fecha: string, hoy: string) {
  if (fecha === hoy) return "Hoy";
  if (fecha === shiftDateKey(hoy, 1)) return "Mañana";
  if (fecha === shiftDateKey(hoy, -1)) return "Ayer";
  return "Fecha elegida";
}

/**
 * Servicio público: las salidas de las terminales de San Martín de los Andes, Villa Traful y Villa
 * La Angostura en un solo tablero. Es la pantalla de boletería: muestra qué sale, con qué unidad y
 * cuántos lugares quedan, y lleva al alta de la reserva con el recorrido y la fecha ya elegidos.
 */
export default async function ServicioPublicoPage({ searchParams }: ServicioPublicoPageProps) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = (await searchParams) ?? {};
  const hoy = argentinaDateKey();
  const fecha = isDateKey(params.fecha) ? params.fecha : hoy;
  const filtro = esTerminal(params.terminal) ? params.terminal : null;

  const [rows, drivers] = await Promise.all([
    listAdminSchedules({ date: fecha }),
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }, { email: "asc" }]
    })
  ]);
  const salidas = salidasDeTerminal(rows);
  const todosLosGrupos = agruparPorTerminal(salidas, rows);
  const grupos = todosLosGrupos.filter((grupo) => (filtro ? grupo.clave === filtro : grupo.salidas.length > 0));
  const terminalesVacias = !filtro ? todosLosGrupos.filter((grupo) => grupo.salidas.length === 0) : [];
  const resumen = resumenDeSalidas(grupos.flatMap((grupo) => grupo.salidas));
  const href = (cambios: { fecha?: string; terminal?: string | null }) => {
    const busqueda = new URLSearchParams();
    const nuevaFecha = cambios.fecha ?? fecha;
    const nuevaTerminal = cambios.terminal === undefined ? filtro : cambios.terminal;
    if (nuevaFecha !== hoy) busqueda.set("fecha", nuevaFecha);
    if (nuevaTerminal) busqueda.set("terminal", nuevaTerminal);
    const query = busqueda.toString();
    return `/admin/servicio-publico${query ? `?${query}` : ""}`;
  };

  return (
    <AdminShell
      title="Servicio público"
      eyebrow="Terminales"
      role={user.role}
      action={
        <div className="form-actions">
          <Link className="ghost-button" href={`/admin/salidas-del-dia?date=${fecha}`}>Salidas del día</Link>
          <Link className="button" href="/admin/reservas/nueva">Vender pasaje</Link>
        </div>
      }
    >
      <div className="sp-board">
        <section className="plain-card sp-controles" aria-label="Fecha y terminal">
          <div className="sp-fecha">
            <Link className="ghost-button" href={href({ fecha: shiftDateKey(fecha, -1) })} aria-label="Día anterior">←</Link>
            <div>
              <p className="eyebrow">{etiquetaDia(fecha, hoy)}</p>
              <strong>{diaFormatter.format(new Date(`${fecha}T12:00:00-03:00`))}</strong>
            </div>
            <Link className="ghost-button" href={href({ fecha: shiftDateKey(fecha, 1) })} aria-label="Día siguiente">→</Link>
            {fecha !== hoy ? <Link className="sp-hoy" href={href({ fecha: hoy })}>Volver a hoy</Link> : null}
          </div>

          <form className="sp-buscar-fecha" action="/admin/servicio-publico" method="get">
            <label htmlFor="fecha">Ir a una fecha</label>
            <input id="fecha" name="fecha" type="date" defaultValue={fecha} />
            {filtro ? <input type="hidden" name="terminal" value={filtro} /> : null}
            <button className="ghost-button" type="submit">Ver</button>
          </form>
        </section>

        <nav className="sp-terminales" aria-label="Terminal">
          <Link className="sp-terminal" data-activa={!filtro ? "si" : undefined} href={href({ terminal: null })}>
            <span>Todas las terminales</span>
            <strong>{resumenDeSalidas(salidas).salidas}</strong>
          </Link>
          {TERMINALES.map((terminal) => {
            const grupo = agruparPorTerminal(salidas, rows).find((item) => item.clave === terminal.clave);
            const cantidad = grupo?.salidas.length ?? 0;
            return (
              <Link
                key={terminal.clave}
                className="sp-terminal"
                data-activa={filtro === terminal.clave ? "si" : undefined}
                href={href({ terminal: terminal.clave })}
              >
                <span>{terminal.nombre}</span>
                <strong>{cantidad}</strong>
              </Link>
            );
          })}
        </nav>

        <section className="sp-resumen" aria-label="Resumen del día">
          <div><span>Salidas</span><strong>{resumen.salidas}</strong></div>
          <div><span>Pasajeros anotados</span><strong>{resumen.pasajeros}</strong></div>
          <div><span>Lugares libres</span><strong>{resumen.libres}</strong></div>
        </section>

        {grupos.map((grupo) => (
          <section className="plain-card sp-grupo" key={grupo.clave}>
            <header className="sp-grupo-head">
              <div>
                <p className="eyebrow">{grupo.corto}</p>
                <h2>Salidas desde {grupo.nombre}</h2>
              </div>
              <span className="sp-grupo-total">{grupo.salidas.length} {grupo.salidas.length === 1 ? "salida" : "salidas"}</span>
            </header>

            {grupo.salidas.length ? (
              <div className="sp-tabla-wrap">
                <table className="sp-tabla">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Recorrido</th>
                      <th>Unidad</th>
                      <th>Chofer</th>
                      <th>Ocupación</th>
                      <th>Estado</th>
                      <th><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.salidas.map((salida) => {
                      const ocupacion = salida.capacidad ? Math.round((salida.ocupados / salida.capacidad) * 100) : 0;
                      const venta = `/admin/reservas/nueva?${new URLSearchParams({
                        desde: salida.desde,
                        hacia: salida.hacia,
                        date: fecha
                      })}`;
                      return (
                        <tr key={salida.id}>
                          <td data-label="Hora"><strong className="sp-hora">{salida.hora}</strong></td>
                          <td data-label="Recorrido">
                            <strong>{salida.recorrido}</strong>
                            <span className="sp-patente">{salida.patente ?? "Sin patente"}</span>
                          </td>
                          <td data-label="Unidad">
                            <Link href={`/admin/naves/${salida.vehicleId}`}>{salida.nave}</Link>
                          </td>
                          <td data-label="Chofer">
                            {salida.driverId && salida.driverName ? (
                              <Link className="sp-chofer-actual" href={`/admin/choferes/${salida.driverId}`}>{salida.driverName}</Link>
                            ) : null}
                            <DriverPicker
                              scheduleId={salida.id}
                              driverId={salida.driverId}
                              drivers={drivers}
                              fecha={fecha}
                              terminal={filtro}
                            />
                          </td>
                          <td data-label="Ocupación">
                            <div className="sp-ocupacion">
                              <span>{salida.ocupados} de {salida.capacidad} ocupados</span>
                              <span className="sp-barra" aria-hidden="true"><i style={{ width: `${Math.min(100, ocupacion)}%` }} /></span>
                              <small>{salida.libres} {salida.libres === 1 ? "lugar" : "lugares"} libres</small>
                            </div>
                          </td>
                          <td data-label="Estado"><span className="sp-estado" data-estado={salida.estado}>{salida.estadoLabel}</span></td>
                          <td data-label="Acciones">
                            <div className="sp-acciones">
                              {salida.libres > 0 ? <Link className="button" href={venta}>Vender</Link> : <span className="sp-completa">Completa</span>}
                              <Link className="ghost-button" href={`/admin/rutas/${salida.routeId}/salidas`}>
                                Ver ruta
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="sp-vacio">No hay salidas de {nombreDeTerminal(grupo.clave)} para este día.</p>
            )}
          </section>
        ))}

        {terminalesVacias.length ? (
          <p className="sp-vacio">
            Sin salidas desde {terminalesVacias.map((grupo) => grupo.nombre).join(" ni ")}.
          </p>
        ) : null}

        {!salidas.length ? (
          <p className="sp-sin-datos">
            No hay salidas de servicio público cargadas para el {diaFormatter.format(new Date(`${fecha}T12:00:00-03:00`))}. Se cargan desde <Link href="/admin/rutas">Rutas → Salidas</Link>.
          </p>
        ) : null}
      </div>
    </AdminShell>
  );
}
