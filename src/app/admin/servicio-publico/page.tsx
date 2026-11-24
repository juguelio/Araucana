import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { ServicePublicNav } from "@/components/service-public-nav";
import { ServicioPublicoVistaNav } from "@/components/servicio-publico-vista-nav";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { roleCanAccess } from "@/lib/auth/roles";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { listAdminSchedules } from "@/lib/booking/repository";
import { prisma } from "@/lib/db/prisma";
import { argentinaDayStart } from "@/lib/booking/admin-filters";
import { isDateKey, shiftDateKey } from "@/lib/operations/day-board";
import { formatoHoras, resumenPorChofer } from "@/lib/public-service/workdays";
import { lunesDe } from "@/lib/school-runs/week";
import { agruparPorTerminal, nombreDeTerminal, resumenDeSalidas, salidasDeTerminal, terminalDe, TERMINALES, type TerminalClave } from "@/lib/public-service/board";
import { DriverPicker } from "./driver-picker";
import "./servicio-publico.css";

export const metadata = { title: "Servicio público · La Araucana" };
export const dynamic = "force-dynamic";

type ServicioPublicoPageProps = {
  searchParams?: Promise<{ fecha?: string; terminal?: string }>;
};

const mesFormatter = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

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

  const mesInicio = `${fecha.slice(0, 7)}-01`;
  const [anio, mes] = fecha.slice(0, 7).split("-").map(Number);
  const mesSiguiente = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
  const [rows, drivers, mesRows] = await Promise.all([
    listAdminSchedules({ date: fecha, activeRoutesOnly: true }),
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }, { email: "asc" }]
    }),
    prisma.schedule.findMany({
      where: {
        departureAt: { gte: argentinaDayStart(mesInicio), lt: argentinaDayStart(mesSiguiente) },
        driverId: { not: null },
        status: { not: "CANCELLED" },
        route: { is: { bookingMode: "SEATED", isActive: true } }
      },
      select: {
        departureAt: true,
        arrivalAt: true,
        driver: { select: { id: true, name: true, email: true } },
        route: { select: { from: true } }
      }
    })
  ]);
  const salidas = salidasDeTerminal(rows);
  const todosLosGrupos = agruparPorTerminal(salidas, rows);
  const grupos = todosLosGrupos.filter((grupo) => (filtro ? grupo.clave === filtro : grupo.salidas.length > 0));
  const terminalesVacias = !filtro ? todosLosGrupos.filter((grupo) => grupo.salidas.length === 0) : [];
  const resumen = resumenDeSalidas(grupos.flatMap((grupo) => grupo.salidas));
  const idsVisibles = new Set(grupos.flatMap((grupo) => grupo.salidas.map((salida) => salida.id)));
  const choferesDelDia = resumenPorChofer(
    rows
      .filter((row) => idsVisibles.has(row.id) && row.status !== "CANCELLED")
      .map((row) => ({
        driverId: row.driverId ?? null,
        driverName: row.driverName ?? null,
        departureAt: new Date(row.departureAt),
        arrivalAt: new Date(row.arrivalAt)
      }))
  );
  const resumenMes = resumenPorChofer(
    mesRows
      .filter((row) => terminalDe(row.route.from))
      .map((row) => ({
        driverId: row.driver?.id ?? null,
        driverName: row.driver ? row.driver.name?.trim() || row.driver.email : null,
        departureAt: new Date(row.departureAt),
        arrivalAt: new Date(row.arrivalAt)
      }))
  );
  const mesLabel = mesFormatter.format(new Date(`${mesInicio}T12:00:00Z`));
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
      <ServicePublicNav actual="boleteria" mostrarRutas={roleCanAccess(user.role, ["ADMIN"])} />
      <ServicioPublicoVistaNav actual="dia" fecha={fecha} semana={lunesDe(fecha)} terminal={filtro} />
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

        {fecha < hoy ? (
          <p className="sp-aviso">Día pasado: el tablero es sólo consulta y las ventas están cerradas.</p>
        ) : null}

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

        <section className="plain-card sp-personal">
          <header className="sp-grupo-head">
            <div>
              <p className="eyebrow">Personal</p>
              <h2>Choferes del día</h2>
            </div>
            <span className="sp-grupo-total">
              {choferesDelDia.length} {choferesDelDia.length === 1 ? "chofer" : "choferes"} con salidas
            </span>
          </header>
          {choferesDelDia.length ? (
            <ul className="sp-choferes-lista">
              {choferesDelDia.map((chofer) => (
                <li key={chofer.driverId}>
                  <Link className="sp-chofer-nombre" href={`/admin/choferes/${chofer.driverId}`}>{chofer.driverName}</Link>
                  <span>{chofer.salidas} {chofer.salidas === 1 ? "salida" : "salidas"}</span>
                  <span className="sp-chofer-horario">{chofer.primerHora} a {chofer.ultimaHora}</span>
                  <strong>{formatoHoras(chofer.horas)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sp-vacio">Todavía no hay choferes asignados a las salidas de este día.</p>
          )}
        </section>

        <details className="plain-card sp-liquidacion" open={resumenMes.length === 0}>
          <summary>
            <span className="sp-liquidacion-titulo">Días trabajados de {mesLabel}</span>
            <span className="sp-liquidacion-meta">
              <small>Base para liquidación · sólo servicio público</small>
              <span className="sp-liquidacion-estado">{resumenMes.length ? `${resumenMes.length} ${resumenMes.length === 1 ? "chofer" : "choferes"}` : "Sin datos"}</span>
              <span className="sp-liquidacion-chevron" aria-hidden="true">⌄</span>
            </span>
          </summary>
          {resumenMes.length ? (
            <div className="sp-tabla-wrap">
              <table className="sp-tabla sp-tabla-mes">
                <thead>
                  <tr>
                    <th>Chofer</th>
                    <th>Días</th>
                    <th>Salidas</th>
                    <th>Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {resumenMes.map((chofer) => (
                    <tr key={chofer.driverId}>
                      <td data-label="Chofer"><Link href={`/admin/choferes/${chofer.driverId}`}>{chofer.driverName}</Link></td>
                      <td data-label="Días"><strong>{chofer.dias.length}</strong></td>
                      <td data-label="Salidas">{chofer.salidas}</td>
                      <td data-label="Horas">{formatoHoras(chofer.horas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="sp-vacio">Todavía no hay días con chofer asignado en {mesLabel}.</p>
          )}
        </details>

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
                              {salida.vendible ? (
                                salida.libres > 0 ? <Link className="button" href={venta}>Vender</Link> : <span className="sp-completa">Completa</span>
                              ) : (
                                <span className="sp-no-venta">{salida.estado === "CANCELLED" ? "Cancelada" : "Venta cerrada"}</span>
                              )}
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
