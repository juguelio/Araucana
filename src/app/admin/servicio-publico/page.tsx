import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { BarraDelDia, ChipsDeFiltro, Cifras, ROTULO_DE_SERVICIOS, SelectorDeVista, textoDeAsignar, vistasDeModulo } from "@/components/modulo/modulo";
import { ServicePublicNav } from "@/components/service-public-nav";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { roleCanAccess } from "@/lib/auth/roles";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { listAdminSchedules } from "@/lib/booking/repository";
import { isDateKey, shiftDateKey } from "@/lib/operations/day-board";
import { lunesDe } from "@/lib/school-runs/week";
import { agruparPorTerminal, nombreDeTerminal, resumenDeSalidas, salidasDeTerminal, TERMINALES, type TerminalClave } from "@/lib/public-service/board";
import { AsignarUnidad, opcionesParaAsignar } from "../naves/en-vivo/asignar-unidad";
import { cargarOcupacionDelDia } from "@/lib/fleet/cargar-ocupacion";
import { ocupacionEnVentana } from "@/lib/fleet/ocupacion";
import "./servicio-publico.css";

export const metadata = { title: "Servicio público · La Araucana" };
export const dynamic = "force-dynamic";

type ServicioPublicoPageProps = {
  searchParams?: Promise<{ fecha?: string; terminal?: string; vista?: string; ok?: string; error?: string }>;
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

  // El landing de Servicio público es la semana: el día queda como detalle de una salida.
  if (params.vista !== "dia") {
    const query = new URLSearchParams({ semana: lunesDe(fecha) });
    if (filtro) query.set("terminal", filtro);
    redirect(`/admin/servicio-publico/semana?${query.toString()}`);
  }

  const [rows, opciones, ocupacionDelDia] = await Promise.all([
    listAdminSchedules({ date: fecha, activeRoutesOnly: true }),
    opcionesParaAsignar(),
    // Qué naves y choferes están en otro servicio ese día, para marcarlos en el modal de asignar.
    cargarOcupacionDelDia(fecha)
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
    busqueda.set("vista", "dia");
    busqueda.set("fecha", nuevaFecha);
    if (nuevaTerminal) busqueda.set("terminal", nuevaTerminal);
    return `/admin/servicio-publico?${busqueda.toString()}`;
  };

  return (
    <AdminShell
      title="Servicio público"
      eyebrow={ROTULO_DE_SERVICIOS}
      role={user.role}
      notice={params.ok ?? params.error}
      action={
        <div className="form-actions">
          <Link className="ghost-button" href="/admin/salidas-del-dia">Salidas del día</Link>
          <Link className="button" href="/admin/reservas/nueva">Vender pasaje</Link>
        </div>
      }
    >
      <ServicePublicNav actual="boleteria" mostrarRutas={roleCanAccess(user.role, ["ADMIN"])} />
      <SelectorDeVista
        actual="dia"
        opciones={vistasDeModulo(
          `/admin/servicio-publico/semana?${new URLSearchParams({ semana: lunesDe(fecha), ...(filtro ? { terminal: filtro } : {}) })}`,
          href({})
        )}
      />
      <BarraDelDia
        accion="/admin/servicio-publico"
        nombre="fecha"
        fecha={fecha}
        anterior={href({ fecha: shiftDateKey(fecha, -1) })}
        siguiente={href({ fecha: shiftDateKey(fecha, 1) })}
        ocultos={{ vista: "dia", terminal: filtro }}
      >
        <ChipsDeFiltro
          etiqueta="Terminal"
          actual={filtro ?? "todas"}
          filtros={[
            { id: "todas", etiqueta: "Todas", href: href({ terminal: null }) },
            ...TERMINALES.map((terminal) => ({ id: terminal.clave, etiqueta: terminal.corto, href: href({ terminal: terminal.clave }) }))
          ]}
        />
      </BarraDelDia>
      <div className="sp-board">

        {fecha < hoy ? (
          <p className="sp-aviso">Día pasado: el tablero es sólo consulta y las ventas están cerradas.</p>
        ) : null}

        <Cifras
          cifras={[
            { rotulo: "Salidas", valor: resumen.salidas },
            { rotulo: "Pasajeros anotados", valor: resumen.pasajeros },
            { rotulo: "Lugares libres", valor: resumen.libres }
          ]}
        />
        <p className="muted flights-note">
          <strong>{diaFormatter.format(new Date(`${fecha}T12:00:00-03:00`)).replace(/^./, (letra) => letra.toUpperCase())}</strong>
          {fecha === hoy ? " · hoy" : ""} · salidas de las terminales de San Martín de los Andes, Villa Traful y Villa La Angostura.
        </p>

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
                            <AsignarUnidad
                              servicioId={`salida-${salida.id}`}
                              eyebrow={`Salida ${salida.hora}`}
                              titulo={salida.recorrido}
                              subtitulo={`${salida.ocupados} ${salida.ocupados === 1 ? "pasajero" : "pasajeros"} · ${salida.vehicleId ? salida.nave : "sin nave asignada"}`}
                              fecha={fecha}
                              naves={opciones.naves}
                              choferes={opciones.choferes}
                              defaultVehicleId={salida.vehicleId}
                              defaultDriverId={salida.driverId ?? ""}
                              ocupacionNaves={ocupacionEnVentana(ocupacionDelDia, "nave", { desde: salida.salidaAt, hasta: salida.llegadaAt }, [`salida:${salida.id}`])}
                              ocupacionChoferes={ocupacionEnVentana(ocupacionDelDia, "chofer", { desde: salida.salidaAt, hasta: salida.llegadaAt }, [`salida:${salida.id}`])}
                              lugaresQueFaltan={salida.ocupados || null}
                              trigger={textoDeAsignar(Boolean(salida.vehicleId && salida.driverId))}
                              triggerClassName="ghost-button modulo-asignar sp-asignar"
                              returnTo={href({})}
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
                              <Link className="ghost-button" href={`/admin/rutas/${salida.routeId}/salidas/${salida.id}/planilla`}>
                                Hoja del chofer
                              </Link>
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
