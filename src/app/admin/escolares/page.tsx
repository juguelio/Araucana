import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { MenuFila } from "@/components/admin-list/menu-fila";
import { ConcesionesNav } from "@/components/concesiones-nav";
import { ConcesionesVistaNav } from "@/components/concesiones-vista-nav";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { cargarOcupacionDelDia } from "@/lib/fleet/cargar-ocupacion";
import { ocupacionEnVentana, type EstadoDeOpcion } from "@/lib/fleet/ocupacion";
import { tituloDeNave } from "@/lib/fleet/titulo-de-nave";
import {
  FILTROS_DEL_DIA, agruparPorTurno, choquesDelDia, estadoDelServicio, leerFiltroDelDia, leerTurno, nombreCorto, ocupacionParaServicio,
  type Choque, type EstadoDelServicio, type FiltroDelDia
} from "@/lib/school-runs/dia";
import { etiquetaDeConcesion, leerTipoDeConcesion } from "@/lib/school-runs/kinds";
import { diasDeSemana, etiquetaDeSemana, lunesDe, sumarDias } from "@/lib/school-runs/week";
import { dateOnly, localInput } from "@/lib/special-trips/data";
import { AsignarRecursosConcesion } from "./asignar-recursos";
import { CalendarioSemana, type ServicioDeCalendario } from "./calendario-semana";
import "./escolares.css";

type Params = { fecha?: string; tipo?: string; aviso?: string; filtro?: string; q?: string; agrupar?: string };

const NOMBRE_FILTRO: Record<FiltroDelDia, string> = { todos: "Todos", falta: "Falta nave o chofer", choque: "Choques", revisar: "Para revisar" };
const NOMBRE_ESTADO: Record<EstadoDelServicio, string> = { falta: "Falta asignar", choque: "Choque", revisar: "Revisar", listo: "Listo" };
const diaLargo = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const sinTildes = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Concesiones · el día (rediseño del 24-nov). Antes: una tabla plana por nombre de recorrido y una
 * fila de fechas sueltas. Ahora el día se lee como lo trabaja la oficina: por horario (o por chofer),
 * con lo que falta resolver arriba —servicios sin nave o sin chofer, choques del mismo chofer o la
 * misma nave a la misma hora, y las notas de «pendiente de revisión» de la planilla— y cruzado con el
 * resto de la operación (servicio público, aeropuerto, viajes especiales y Chapelco) para que el
 * selector diga quién ya está ocupado a esa hora.
 */
export default async function SchoolsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const tipo = leerTipoDeConcesion(params.tipo);
  if (!params.fecha) {
    const query = new URLSearchParams();
    if (tipo) query.set("tipo", tipo);
    if (params.aviso) query.set("aviso", params.aviso);
    redirect(`/admin/escolares/semana${query.size ? `?${query}` : ""}`);
  }
  const day = dateOnly(params.fecha);
  if (!day) redirect(`/admin/escolares/semana${tipo ? `?tipo=${tipo}` : ""}`);
  const date = day.toISOString().slice(0, 10);
  const hoy = localInput(new Date()).slice(0, 10);
  const filtro = leerFiltroDelDia(params.filtro);
  const buscar = (params.q ?? "").trim();
  const porChofer = params.agrupar === "chofer";
  const semana = diasDeSemana(lunesDe(date));
  const delTipo = tipo ? { kind: tipo } : {};

  const [runs, deLaSemana, naves, choferes, ocupaciones] = await Promise.all([
    prisma.schoolRun.findMany({
      where: { serviceDate: day, ...delTipo },
      orderBy: [{ routeName: "asc" }, { id: "asc" }],
      include: { driver: { select: { name: true, email: true } }, vehicle: { select: { name: true, internalNumber: true } } }
    }),
    // El calendario semanal de arriba: los siete días, con sus servicios.
    prisma.schoolRun.findMany({
      where: { serviceDate: { gte: new Date(`${semana[0]}T00:00:00Z`), lte: new Date(`${semana[6]}T00:00:00Z`) }, ...delTipo },
      orderBy: [{ serviceDate: "asc" }, { routeName: "asc" }],
      select: {
        id: true, serviceDate: true, kind: true, routeName: true, shift: true, companion: true,
        driver: { select: { name: true, email: true } }, vehicle: { select: { name: true } }
      }
    }),
    prisma.vehicle.findMany({
      where: { isActive: true, kind: { not: "UTILITARIO" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, internalNumber: true, licensePlate: true }
    }),
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true }
    }),
    // El resto de la operación ese día; si falla, la página se ve igual, sin ese cruce.
    cargarOcupacionDelDia(date).catch(() => [])
  ]);

  // Los choques entre servicios de Concesiones (con todos los tipos: un chofer puede tener una escuela
  // y personal de aeropuerto a la misma hora) y, para cada servicio con hora, el resto del día.
  const todosDelDia = tipo
    ? await prisma.schoolRun.findMany({ where: { serviceDate: day }, select: { id: true, routeName: true, shift: true, driverId: true, vehicleId: true, review: true } })
    : runs;
  const choques = choquesDelDia(todosDelDia);
  const externos = new Map<string, { naves: Record<string, EstadoDeOpcion>; choferes: Record<string, EstadoDeOpcion> }>();
  for (const run of runs) {
    const turno = leerTurno(run.shift);
    const ventana = turno.minutos !== null
      ? { desde: new Date(`${date}T${turno.clave}:00-03:00`), hasta: new Date(new Date(`${date}T${turno.clave}:00-03:00`).getTime() + 60_000) }
      : turno.cubre && turno.clave
        ? { desde: new Date(new Date(`${date}T00:00:00-03:00`).getTime() + turno.cubre[0] * 60_000), hasta: new Date(new Date(`${date}T00:00:00-03:00`).getTime() + turno.cubre[1] * 60_000) }
        : null;
    if (!ventana) continue;
    // Un turno con nombre es un rango largo: lo que cae adentro es un posible cruce, no uno seguro.
    const suavizar = (estados: Record<string, EstadoDeOpcion>) =>
      turno.minutos !== null ? estados : Object.fromEntries(Object.entries(estados).map(([id, e]) => [id, { ...e, estado: "posible" as const }]));
    externos.set(run.id, {
      naves: suavizar(ocupacionEnVentana(ocupaciones, "nave", ventana)),
      choferes: suavizar(ocupacionEnVentana(ocupaciones, "chofer", ventana))
    });
  }
  const choquesDe = (run: (typeof runs)[number]): Choque[] => {
    const propios = choques.get(run.id) ?? [];
    const fuera = externos.get(run.id);
    const deFuera: Choque[] = [];
    if (fuera && run.driverId && fuera.choferes[run.driverId]) {
      const e = fuera.choferes[run.driverId];
      deFuera.push({ recurso: "chofer", seguro: e.estado === "ocupada", conId: "", detalle: e.detalle });
    }
    if (fuera && run.vehicleId && fuera.naves[run.vehicleId]) {
      const e = fuera.naves[run.vehicleId];
      deFuera.push({ recurso: "nave", seguro: e.estado === "ocupada", conId: "", detalle: e.detalle });
    }
    return [...propios, ...deFuera];
  };

  const filas = runs.map((run) => {
    const suyos = choquesDe(run);
    const chofer = run.driver ? run.driver.name?.trim() || run.driver.email : null;
    return { run, choques: suyos, estado: estadoDelServicio(run, suyos), chofer, nave: run.vehicle ? tituloDeNave(run.vehicle) : null };
  });
  const cuentas: Record<FiltroDelDia, number> = {
    todos: filas.length,
    falta: filas.filter((f) => f.estado === "falta").length,
    choque: filas.filter((f) => f.choques.some((c) => c.seguro)).length,
    revisar: filas.filter((f) => f.estado === "revisar" || (f.estado !== "falta" && Boolean(f.run.review?.trim()))).length
  };
  const pasaFiltro = (fila: (typeof filas)[number]) =>
    filtro === "todos" ||
    (filtro === "falta" && fila.estado === "falta") ||
    (filtro === "choque" && fila.choques.some((c) => c.seguro)) ||
    (filtro === "revisar" && (fila.estado === "revisar" || Boolean(fila.run.review?.trim())));
  const pasaBusqueda = (fila: (typeof filas)[number]) =>
    !buscar || sinTildes([fila.run.routeName, fila.chofer, fila.nave, fila.run.companion, fila.run.shift].filter(Boolean).join(" ")).includes(sinTildes(buscar));
  const visibles = filas.filter((fila) => pasaFiltro(fila) && pasaBusqueda(fila));
  const choferesDelDia = new Set(filas.map((f) => f.run.driverId).filter(Boolean)).size;
  const navesDelDia = new Set(filas.map((f) => f.run.vehicleId).filter(Boolean)).size;

  const grupos = porChofer
    ? [...visibles.reduce((mapa, fila) => {
        const clave = fila.run.driverId ?? "";
        const grupo = mapa.get(clave) ?? { clave, titulo: fila.chofer ?? "Sin chofer", filas: [] as typeof visibles };
        grupo.filas.push(fila);
        return mapa.set(clave, grupo);
      }, new Map<string, { clave: string; titulo: string; filas: typeof visibles }>()).values()]
        .sort((a, b) => Number(Boolean(a.clave)) - Number(Boolean(b.clave)) || a.titulo.localeCompare(b.titulo, "es"))
        .map((grupo) => ({ ...grupo, filas: grupo.filas.sort((a, b) => leerTurno(a.run.shift).orden - leerTurno(b.run.shift).orden), subtitulo: `${grupo.filas.length} ${grupo.filas.length === 1 ? "servicio" : "servicios"}` }))
    : agruparPorTurno(visibles.map((fila) => ({ ...fila, shift: fila.run.shift, routeName: fila.run.routeName }))).map(({ turno, servicios }) => ({
        clave: turno.clave || "sin-horario",
        titulo: turno.etiqueta,
        filas: servicios,
        subtitulo: `${servicios.length} ${servicios.length === 1 ? "servicio" : "servicios"}`
      }));

  const enlace = (cambios: Partial<Record<"fecha" | "filtro" | "q" | "agrupar", string | null>>) => {
    const query = new URLSearchParams();
    const valores = { fecha: date, tipo, filtro: filtro === "todos" ? null : filtro, q: buscar || null, agrupar: porChofer ? "chofer" : null, ...cambios };
    for (const [clave, valor] of Object.entries(valores)) if (valor) query.set(clave, valor);
    return `/admin/escolares?${query}`;
  };
  const returnTo = `/admin/escolares?fecha=${date}${tipo ? `&tipo=${tipo}` : ""}`;
  const choferesOpcion = choferes.map((chofer) => ({ id: chofer.id, label: chofer.name?.trim() || chofer.email, email: chofer.email }));
  const porDiaSemana = new Map<string, ServicioDeCalendario[]>(semana.map((dia) => [dia, []]));
  for (const run of deLaSemana) {
    porDiaSemana.get(run.serviceDate.toISOString().slice(0, 10))?.push({
      id: run.id, kind: run.kind, routeName: run.routeName, shift: run.shift, companion: run.companion,
      chofer: run.driver ? run.driver.name?.trim() || run.driver.email : null, nave: run.vehicle?.name ?? null
    });
  }
  const hrefNuevo = (dia: string) => `/admin/escolares/nuevo?fecha=${dia}${tipo ? `&tipo=${tipo}` : ""}`;
  const fechaUtc = (dia: string) => new Date(`${dia}T12:00:00Z`);

  return (
    <AdminShell title="Concesiones" eyebrow="Servicios recurrentes" role={user.role} notice={params.aviso}
      action={<div className="inline-actions"><Link className="ghost-button" href={`/admin/escolares/semana?semana=${semana[0]}${tipo ? `&tipo=${tipo}` : ""}`}>Volver al calendario</Link><Link className="ghost-button" href="/admin/escolares/importar">Importar planilla</Link><Link className="button" href={hrefNuevo(date)}>Nuevo servicio</Link></div>}>
      <ConcesionesNav actual={tipo ?? "todos"} fecha={date} />
      <ConcesionesVistaNav actual="dia" tipo={tipo} fecha={date} semana={lunesDe(date)} />
      {tipo === "personal-aeropuerto" ? <p className="muted school-kind-help">Traslado diario de personal, por ejemplo al aeropuerto. No es el tablero de vuelos de pasajeros: eso sigue en Aeropuerto.</p> : null}

      <nav className="cd-dia" aria-label="Día">
        <Link className="cd-flecha" href={enlace({ fecha: sumarDias(date, -1) })} aria-label="Día anterior">‹</Link>
        <div className="cd-dia-texto">
          <strong>{diaLargo.format(fechaUtc(date))}</strong>
          <span>{date === hoy ? "Hoy" : date === sumarDias(hoy, 1) ? "Mañana" : date === sumarDias(hoy, -1) ? "Ayer" : date.split("-").reverse().join("/")}</span>
        </div>
        <Link className="cd-flecha" href={enlace({ fecha: sumarDias(date, 1) })} aria-label="Día siguiente">›</Link>
        {date !== hoy ? <Link className="ghost-button" href={enlace({ fecha: hoy })}>Hoy</Link> : null}
        <form className="cd-ir" method="get" action="/admin/escolares">
          {tipo ? <input type="hidden" name="tipo" value={tipo} /> : null}
          <label className="sr-only" htmlFor="cd-fecha">Ir a otro día</label>
          <input id="cd-fecha" type="date" name="fecha" defaultValue={date} required />
          <button className="ghost-button" type="submit">Ir</button>
        </form>
      </nav>

      <div className="cd-semana-cabeza">
        <strong>Semana del {etiquetaDeSemana(semana[0])}</strong>
        <Link className="ghost-button" href={enlace({ fecha: sumarDias(date, -7) })}>‹ Semana anterior</Link>
        <Link className="ghost-button" href={enlace({ fecha: sumarDias(date, 7) })}>Semana siguiente ›</Link>
      </div>
      <CalendarioSemana
        dias={semana}
        hoy={hoy}
        porDia={porDiaSemana}
        seleccionado={date}
        compacto
        hrefDia={(dia) => enlace({ fecha: dia })}
        hrefNuevo={hrefNuevo}
        hrefServicio={(dia, servicio) => dia === date ? `${enlace({ filtro: null, q: null })}#servicio-${servicio.id}` : `${enlace({ fecha: dia, filtro: null, q: null })}#servicio-${servicio.id}`}
        etiqueta={`Calendario de la semana del ${etiquetaDeSemana(semana[0])}`}
      />

      <section className="cd-cifras" aria-label="Resumen del día">
        <div className="cd-cifra"><strong>{filas.length}</strong><span>{filas.length === 1 ? "servicio" : "servicios"}</span></div>
        <div className="cd-cifra"><strong>{choferesDelDia}</strong><span>{choferesDelDia === 1 ? "chofer" : "choferes"} · {navesDelDia} {navesDelDia === 1 ? "nave" : "naves"}</span></div>
        <Link className="cd-cifra" href={enlace({ filtro: "falta" })} data-alerta={cuentas.falta ? "" : undefined}><strong>{cuentas.falta}</strong><span>sin nave o sin chofer</span></Link>
        <Link className="cd-cifra" href={enlace({ filtro: "choque" })} data-alerta={cuentas.choque ? "" : undefined}><strong>{cuentas.choque}</strong><span>{cuentas.choque === 1 ? "choque" : "choques"} de horario</span></Link>
        <Link className="cd-cifra" href={enlace({ filtro: "revisar" })} data-aviso={cuentas.revisar ? "" : undefined}><strong>{cuentas.revisar}</strong><span>para revisar</span></Link>
      </section>

      <div className="cd-herramientas">
        <nav className="cd-filtros" aria-label="Filtrar servicios">
          {FILTROS_DEL_DIA.map((cual) => (
            <Link key={cual} href={enlace({ filtro: cual === "todos" ? null : cual })} aria-current={cual === filtro ? "page" : undefined} className="cd-filtro" data-alerta={cual !== "todos" && cuentas[cual] ? cual : undefined}>
              {NOMBRE_FILTRO[cual]} <span>{cuentas[cual]}</span>
            </Link>
          ))}
        </nav>
        <form className="cd-buscar" method="get" action="/admin/escolares" role="search">
          <input type="hidden" name="fecha" value={date} />
          {tipo ? <input type="hidden" name="tipo" value={tipo} /> : null}
          {filtro !== "todos" ? <input type="hidden" name="filtro" value={filtro} /> : null}
          {porChofer ? <input type="hidden" name="agrupar" value="chofer" /> : null}
          <label className="sr-only" htmlFor="cd-q">Buscar</label>
          <input id="cd-q" type="search" name="q" defaultValue={buscar} placeholder="Recorrido, chofer, nave o acompañante" />
          <button className="ghost-button" type="submit">Buscar</button>
        </form>
        <nav className="cd-agrupar" aria-label="Agrupar">
          <Link href={enlace({ agrupar: null })} aria-current={!porChofer ? "page" : undefined}>Por horario</Link>
          <Link href={enlace({ agrupar: "chofer" })} aria-current={porChofer ? "page" : undefined}>Por chofer</Link>
        </nav>
      </div>

      {!runs.length ? (
        <div className="cd-vacio">
          <p>No hay servicios {tipo ? etiquetaDeConcesion(tipo).toLowerCase() : "de Concesiones"} para este día.</p>
          <div className="inline-actions">
            <Link className="button" href={`/admin/escolares/nuevo?fecha=${date}${tipo ? `&tipo=${tipo}` : ""}`}>Cargar un servicio</Link>
            <Link className="ghost-button" href="/admin/escolares/importar">Importar la planilla</Link>
          </div>
        </div>
      ) : !visibles.length ? (
        <div className="cd-vacio">
          <p>{buscar ? `Ningún servicio coincide con «${buscar}».` : filtro === "falta" ? "Todos los servicios tienen nave y chofer." : filtro === "choque" ? "No hay choques de horario." : "No hay nada para revisar."}</p>
          <Link className="ghost-button" href={enlace({ filtro: null, q: null })}>Ver todos</Link>
        </div>
      ) : (
        <div className="cd-grupos">
          {grupos.map((grupo) => (
            <section key={grupo.clave} className="cd-grupo" aria-labelledby={`cd-g-${grupo.clave}`}>
              <header className="cd-grupo-cabeza">
                <h2 id={`cd-g-${grupo.clave}`}>{grupo.titulo}</h2>
                <span>{grupo.subtitulo}</span>
              </header>
              <ul className="cd-lista" role="list">
                {grupo.filas.map(({ run, choques: suyos, estado, chofer, nave }) => {
                  const ocupacion = ocupacionParaServicio(run, todosDelDia, externos.get(run.id));
                  return (
                    <li key={run.id} id={`servicio-${run.id}`} className="cd-servicio" data-estado={estado}>
                      <div className="cd-servicio-que">
                        <span className="cd-servicio-hora">{porChofer ? leerTurno(run.shift).etiqueta : null}</span>
                        <Link className="cd-servicio-nombre" href={`/admin/escolares/${run.id}`}>{run.routeName}</Link>
                        <span className="cd-servicio-meta">
                          <span className="cd-tipo" data-tipo={run.kind}>{etiquetaDeConcesion(run.kind)}</span>
                          {!porChofer && leerTurno(run.shift).etiqueta !== run.shift.trim() && run.shift.trim() ? <span>{run.shift}</span> : null}
                          {run.companion ? <span>Con {run.companion}</span> : null}
                        </span>
                      </div>
                      <div className="cd-servicio-quien">
                        <span className="cd-recurso" data-vacio={!chofer || undefined} title={chofer ?? undefined}>
                          <small>Chofer</small>{chofer ? nombreCorto(chofer) : "Sin chofer"}
                        </span>
                        <span className="cd-recurso" data-vacio={!nave || undefined}>
                          <small>Nave</small>{nave ?? "Sin nave"}
                        </span>
                      </div>
                      <div className="cd-servicio-accion">
                        <span className="cd-estado" data-estado={estado}>{NOMBRE_ESTADO[estado]}</span>
                        <AsignarRecursosConcesion
                          id={run.id}
                          titulo={run.routeName}
                          subtitulo={run.shift}
                          fecha={date}
                          revision={run.revision}
                          returnTo={returnTo}
                          naves={naves}
                          choferes={choferesOpcion}
                          naveActual={run.vehicleId ?? ""}
                          choferActual={run.driverId ?? ""}
                          ocupacionNaves={ocupacion.naves}
                          ocupacionChoferes={ocupacion.choferes}
                          trigger={estado === "falta" ? "Asignar" : "Cambiar"}
                          triggerClassName={estado === "falta" ? "button cd-asignar" : "ghost-button cd-asignar"}
                        />
                        <MenuFila etiqueta={`Más opciones de ${run.routeName}`}>
                          <Link href={`/admin/escolares/${run.id}`}>Ver ficha</Link>
                          <Link href={`/admin/escolares/${run.id}/editar`}>Editar servicio</Link>
                        </MenuFila>
                      </div>
                      {suyos.length || run.review?.trim() || run.notes?.trim() ? (
                        <ul className="cd-avisos" role="list">
                          {suyos.map((choque, i) => (
                            <li key={`${choque.conId}-${choque.recurso}-${i}`} data-tono={choque.seguro ? "choque" : "posible"}>
                              <b>{choque.seguro ? "Choque" : "Posible cruce"}:</b>{" "}
                              {choque.recurso === "chofer" ? `${chofer ? nombreCorto(chofer) : "el chofer"} también está en` : `la nave ${nave ?? ""} también está en`}{" "}
                              {choque.conId ? <Link href={`/admin/escolares/${choque.conId}`}>{choque.detalle}</Link> : choque.detalle}
                            </li>
                          ))}
                          {run.review?.trim() ? <li data-tono="revisar"><b>Revisar:</b> {run.review}</li> : null}
                          {run.notes?.trim() ? <li data-tono="nota"><b>Obs.:</b> {run.notes}</li> : null}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
