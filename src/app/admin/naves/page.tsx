import Link from "next/link";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin-shell";
import { MenuFila } from "@/components/admin-list/menu-fila";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { complianceLabel, formatoFecha } from "@/lib/vehicles/compliance";
import { leerOrdenDelListado, ordenarNaves, paginarNaves } from "@/lib/vehicles/fleet-table";
import { cadenciaTecnica, edadDeNave, filtrarNaves, leerFiltroFlota, papelesDeNave } from "@/lib/vehicles/fleet-board";
import {
  alertasDeNave,
  coincideBusqueda,
  entraEnPestana,
  estadoDeNave,
  etiquetaCortaDeNave,
  leerPestanaDeFlota,
  type PestanaDeFlota
} from "@/lib/vehicles/estado-en-flota";
import type { Recorrido } from "@/lib/vehicles/ficha";
import { proximoYHoy, type ServicioDeNave } from "@/lib/vehicles/servicio-en-curso";
import { enlaceAlMapa } from "@/lib/vehicles/enlace-mapa";
import { cargarSenalesDeChoferes, cargarServiciosDeLaFlota, type SenalDelChofer } from "./servicios-de-la-flota";
import "./naves.css";

type AdminVehiclesPageProps = {
  searchParams?: Promise<{ notice?: string; q?: string; vista?: string; tipo?: string; papel?: string; edad?: string; uso?: string; orden?: string; dir?: string; page?: string; porPagina?: string }>;
};

const PESTANAS: Array<{ id: PestanaDeFlota; etiqueta: string }> = [
  { id: "todas", etiqueta: "Toda la flota" },
  { id: "activas", etiqueta: "Activas" },
  { id: "recorrido", etiqueta: "En la calle" },
  { id: "alertas", etiqueta: "Con alertas" },
  { id: "inactivas", etiqueta: "No habilitadas" }
];

const AYUDA: Record<PestanaDeFlota, string> = {
  todas: "Todas las unidades cargadas. Las pestañas son filtros que se superponen: una unidad puede estar en la calle y además tener una alerta.",
  activas: "Pueden salir hoy: habilitadas, fuera de taller y sin alertas pendientes. Si tienen un aviso, están en Con alertas.",
  recorrido: "Trabajando o con señal del chofer en la calle.",
  alertas: "Papeles vencidos o por vencer, daños o capacidad sin cargar. Hay algo para resolver.",
  taller: "Daño grave o reparación en curso.",
  publico: "Unidades habilitadas para transporte público de pasajeros.",
  inactivas: "Fuera de la flota, de uso interno o con 15 años o más: no transportan pasajeros."
};

function lugarCorto(lugar: string) {
  return lugar.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim() === "san martin de los andes" ? "San Martín" : lugar;
}

const horaArgentina = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
const diaCorto = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

function cuandoSale(recorrido: Recorrido, dia: string, hoy: string) {
  const manana = new Date(new Date(`${hoy}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const fecha = dia === hoy ? "Hoy" : dia === manana ? "Mañana" : diaCorto.format(new Date(`${dia}T00:00:00Z`)).replace(/\./g, "").replace(",", "");
  return recorrido.soloDia ? fecha : `${fecha} ${horaArgentina.format(recorrido.desde)}`;
}

function tituloCorto(recorrido: Recorrido) {
  return recorrido.titulo.split(" → ").map(lugarCorto).join(" → ");
}

function hastaCuando(servicio: ServicioDeNave) {
  return servicio.ventana ? `Ahora · hasta ${horaArgentina.format(servicio.ventana.hasta)}` : "Ahora";
}

function senalEnPalabras(senal: SenalDelChofer) {
  const hace = senal.minutos === 0 ? "recién" : `hace ${senal.minutos} min`;
  return [senal.detenido ? "Detenida" : null, senal.chofer, `señal ${hace}`].filter(Boolean).join(" · ");
}

function Dato({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <dt>{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function textoCadencia(cadencia: ReturnType<typeof cadenciaTecnica>) {
  if (cadencia === "sin habilitación") return "Sin habilitación para pasajeros (15 años o más)";
  return cadencia ? `Cada ${cadencia}` : "Sin antigüedad cargada";
}

export default async function AdminVehiclesPage({ searchParams }: AdminVehiclesPageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const ahora = new Date();
  const pestana = leerPestanaDeFlota(params?.vista);
  const busqueda = params?.q?.trim() ?? "";
  const filtro = leerFiltroFlota({ tipo: params?.tipo, papel: params?.papel, edad: params?.edad, uso: params?.uso });
  const orden = leerOrdenDelListado({ orden: params?.orden, dir: params?.dir, page: params?.page });
  const porPagina = params?.porPagina === "todas" ? 0 : params?.porPagina === "24" ? 24 : 12;

  const [flota, danios, servicios, senales] = await Promise.all([
    prisma.vehicle.findMany({ include: { _count: { select: { seats: true } } } }),
    prisma.vehicleDamage.findMany({ where: { status: { not: "REPARADO" } }, select: { vehicleId: true, status: true, severity: true } }),
    cargarServiciosDeLaFlota(ahora),
    cargarSenalesDeChoferes(ahora)
  ]);

  const hoyDia = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).format(ahora);
  const naves = ordenarNaves(
    flota.map((vehicle) => ({ ...vehicle, asientos: vehicle._count.seats })),
    "unidad",
    "asc",
    ahora
  ).map((vehicle) => {
    // Cruce de datos: lo programado en salidas, viajes especiales y aeropuerto dice si la nave está en
    // un servicio ahora; la señal del celular del chofer, si alguien la está manejando.
    const { enCurso, proximo, hoy, diaDe } = proximoYHoy(servicios.get(vehicle.id), ahora);
    const senal = senales.get(vehicle.id) ?? null;
    const datos = {
      ...vehicle,
      danios: danios.filter((danio) => danio.vehicleId === vehicle.id),
      serviciosHoy: hoy,
      enRecorrido: Boolean(enCurso),
      enMovimiento: Boolean(senal && !senal.detenido)
    };
    const estado = estadoDeNave(datos);
    const alertas = alertasDeNave(datos, ahora);
    return { vehicle, estado, alertas, enCurso, senal, proximo, proximoDia: proximo ? diaDe(proximo) : null, serviciosHoy: hoy };
  });

  const cuentas = Object.fromEntries(
    PESTANAS.map(({ id }) => [
      id,
      naves.filter((nave) =>
        entraEnPestana(id, nave.vehicle, nave.estado, nave.alertas.principal, edadDeNave(nave.vehicle, ahora)?.anios ?? null)
      ).length
    ])
  ) as Record<PestanaDeFlota, number>;

  const visibles = naves.filter(
    (nave) =>
      (busqueda ? true : entraEnPestana(pestana, nave.vehicle, nave.estado, nave.alertas.principal, edadDeNave(nave.vehicle, ahora)?.anios ?? null)) &&
      coincideBusqueda(nave.vehicle, busqueda)
  );
  const filtradas = ordenarNaves(
    filtrarNaves(
      visibles.map((nave) => nave.vehicle),
      filtro,
      ahora
    ),
    orden.orden,
    orden.dir,
    ahora
  );
  const tamanoPagina = porPagina === 0 ? Math.max(1, filtradas.length) : porPagina;
  const pagina = paginarNaves(filtradas, orden.page, tamanoPagina);
  const porId = new Map(visibles.map((nave) => [nave.vehicle.id, nave]));
  const asientos = filtradas.reduce((total, nave) => total + nave.asientos, 0);

  const urlFlota = (cambios: Record<string, string | null | undefined>) => {
    const query = new URLSearchParams();
    const valores: Record<string, string | null | undefined> = {
      vista: pestana === "todas" ? null : pestana,
      q: busqueda || null,
      tipo: filtro.tipo || null,
      papel: filtro.papel || null,
      edad: filtro.edad || null,
      uso: filtro.uso || null,
      orden: orden.orden,
      dir: orden.orden ? orden.dir : null,
      page: pagina.page > 1 ? String(pagina.page) : null,
      porPagina: porPagina === 0 ? "todas" : porPagina === 24 ? "24" : null,
      ...cambios
    };
    for (const [clave, valor] of Object.entries(valores)) {
      if (valor) query.set(clave, valor);
    }
    const texto = query.toString();
    return `/admin/naves${texto ? `?${texto}` : ""}`;
  };

  const numerosPagina =
    pagina.totalPages <= 7
      ? Array.from({ length: pagina.totalPages }, (_, indice) => indice + 1)
      : Array.from(new Set([1, pagina.page - 1, pagina.page, pagina.page + 1, pagina.totalPages])).filter((numero) => numero >= 1 && numero <= pagina.totalPages).sort((a, b) => a - b);

  const paginador = (ubicacion: string) => (
    <div className="naves-paginacion" data-ubicacion={ubicacion}>
      <span className="naves-paginacion-cuenta">
        {pagina.total === 0 ? "Sin unidades" : `${pagina.desde}–${pagina.hasta} de ${pagina.total}`}
      </span>
      <span className="naves-pagina-actual">Página {pagina.page} de {pagina.totalPages}</span>
      {pagina.totalPages > 1 ? (
        <nav className="naves-paginacion-nav" aria-label={`Páginas de la flota (${ubicacion})`}>
          {pagina.page > 1 ? <Link href={urlFlota({ page: pagina.page === 2 ? null : String(pagina.page - 1) })}>‹ Anterior</Link> : <span>‹ Anterior</span>}
          {numerosPagina.map((numero) => (
            <Link
              key={numero}
              href={urlFlota({ page: numero === 1 ? null : String(numero) })}
              aria-current={numero === pagina.page ? "page" : undefined}
            >
              {numero}
            </Link>
          ))}
          {pagina.page < pagina.totalPages ? <Link href={urlFlota({ page: String(pagina.page + 1) })}>Siguiente ›</Link> : <span>Siguiente ›</span>}
        </nav>
      ) : null}
      <span className="naves-por-pagina">
        Por página:
        {[12, 24, 0].map((cantidad) => {
          const activo = (cantidad === 0 && porPagina === 0) || (cantidad !== 0 && porPagina === cantidad);
          return activo ? (
            <strong key={cantidad}>{cantidad === 0 ? "Todas" : cantidad}</strong>
          ) : (
            <Link key={cantidad} href={urlFlota({ porPagina: cantidad === 0 ? "todas" : String(cantidad), page: null })}>
              {cantidad === 0 ? "Todas" : cantidad}
            </Link>
          );
        })}
      </span>
    </div>
  );

  return (
    <AdminShell
      role={sessionUser.role}
      title="Naves"
      notice={params?.notice}
      action={
        <div className="table-actions">
          <Link className="ghost-button" href="/admin/naves/en-vivo">
            Naves en vivo
          </Link>
          <Link className="button" href="/admin/naves/nueva">
            Agregar nave
          </Link>
        </div>
      }
    >
      <form action="/admin/naves" method="get" className="naves-buscar" role="search">
        <label className="sr-only" htmlFor="naves-q">Buscar nave</label>
        <input id="naves-q" name="q" type="search" defaultValue={busqueda} maxLength={60} placeholder="Buscar: interno, patente o modelo" />
        <button className="button" type="submit">Buscar</button>
      </form>

      <nav className="naves-pestanas" aria-label="Estados de la flota">
        {PESTANAS.map((item) => (
          <Link
            key={item.id}
            className="naves-pestana"
            href={urlFlota({ vista: item.id === "todas" ? null : item.id, page: null })}
            aria-current={pestana === item.id && !busqueda ? "page" : undefined}
            data-alerta={item.id === "alertas" && cuentas[item.id] > 0 ? true : undefined}
          >
            {item.etiqueta}
            <span className="naves-pestana-cuenta">{cuentas[item.id]}</span>
          </Link>
        ))}
      </nav>
      <p className="naves-ayuda">{busqueda ? "Resultados de la búsqueda en toda la flota." : AYUDA[pestana]}</p>

      <p className="naves-resumen" role="status">
        {busqueda ? <>Resultados para «{busqueda}» · </> : null}
        {filtradas.length === 0
          ? "No hay naves para mostrar."
          : `${filtradas.length} ${filtradas.length === 1 ? "nave" : "naves"} · ${asientos} asientos`}
        {busqueda ? <> · <Link href="/admin/naves">Ver todas</Link></> : null}
      </p>

      <form action="/admin/naves" method="get" className="naves-filtros" aria-label="Filtros de flota">
        {pestana !== "todas" ? <input type="hidden" name="vista" value={pestana} /> : null}
        {busqueda ? <input type="hidden" name="q" value={busqueda} /> : null}
        <label>Tipo
          <select name="tipo" defaultValue={filtro.tipo}>
            <option value="">Todos</option>
            <option value="BUS">Buses</option>
            <option value="CAMIONETA">Camionetas</option>
            <option value="UTILITARIO">Utilitarios</option>
          </select>
        </label>
        <label>Papeles
          <select name="papel" defaultValue={filtro.papel}>
            <option value="">Todos</option>
            <option value="vencido">Vencidos</option>
            <option value="proximo">Vencen en 30 días</option>
            <option value="ok">Al día</option>
          </select>
        </label>
        <label>Antigüedad
          <select name="edad" defaultValue={filtro.edad}>
            <option value="">Todas</option>
            <option value="0-10">Hasta 10 años</option>
            <option value="10-15">10 a 15 años</option>
            <option value="15+">15 años o más</option>
          </select>
        </label>
        <label>Uso
          <select name="uso" defaultValue={filtro.uso}>
            <option value="">Todos</option>
            <option value="publico">Transporte público</option>
            <option value="interno">Uso interno</option>
            <option value="no-habilitada">No habilitadas</option>
          </select>
        </label>
        <button className="button" type="submit">Aplicar</button>
        <Link className="ghost-button" href="/admin/naves">Limpiar</Link>
      </form>

      {paginador("arriba")}

      {pagina.items.length === 0 ? (
        <p className="naves-vacio">No hay naves con esos filtros.</p>
      ) : (
        <ul className="naves-lista">
          {pagina.items.map((vehicle) => {
            const fila = porId.get(vehicle.id);
            if (!fila) return null;
            const { estado, alertas, enCurso, senal, proximo, proximoDia, serviciosHoy } = fila;
            const ficha = `/admin/naves/${vehicle.id}`;
            const nombre = vehicle.internalNumber ? `Interno ${vehicle.internalNumber}` : vehicle.name;
            const edad = edadDeNave(vehicle, ahora);
            const cadencia = cadenciaTecnica(edad?.anios ?? null);
            const papeles = papelesDeNave(vehicle, ahora);
            const noHabilitada =
              !vehicle.isActive ||
              !vehicle.publicTransport ||
              (edad !== null && edad.anios >= 15);
            const alertaVisible = alertas.principal?.tono === "grave" || alertas.principal?.tono === "atencion";
            const estadoCorto = noHabilitada
              ? vehicle.isActive && !vehicle.publicTransport && vehicle.kind === "UTILITARIO"
                ? "Uso interno"
                : "No habilitada"
              : alertaVisible
                ? "Con alerta"
                : etiquetaCortaDeNave(estado);
            const tonoEstado = noHabilitada ? "normal" : alertaVisible ? alertas.principal!.tono : estado.tono;
            return (
              <li
                key={vehicle.id}
                className="naves-fila"
                data-tono={estado.tono === "grave" || alertas.principal?.tono === "grave" ? "grave" : undefined}
                data-inactiva={!vehicle.isActive || undefined}
              >
                <div className="naves-fila-resumen">
                  <Link className="naves-fila-interno" href={ficha} title={`Ver la ficha de ${nombre}`}>
                    {vehicle.internalNumber ? (
                      <>
                        <span className="naves-fila-interno-rotulo">Interno</span>
                        <strong>{vehicle.internalNumber}</strong>
                      </>
                    ) : (
                      <strong className="naves-fila-sin-interno">{vehicle.name}</strong>
                    )}
                  </Link>

                  <div className="naves-fila-unidad">
                    <Link className="naves-fila-modelo" href={ficha}>{vehicle.brand} {vehicle.model}</Link>
                    <span className="naves-fila-extra">
                      <span className="naves-fila-patente">{vehicle.licensePlate ?? "sin patente"}</span>
                      <span>{vehicle.year ?? "sin año"}</span>
                      <span>{edad ? `${edad.anios} años${edad.estimada ? " (est.)" : ""}` : "antigüedad sin dato"}</span>
                      {vehicle.asientos > 0 ? <span>{vehicle.asientos} asientos</span> : null}
                      <span className={vehicle.publicTransport ? "naves-fila-tp" : undefined}>
                        {vehicle.publicTransport ? "Transporte público" : vehicle.kind === "UTILITARIO" ? "Uso interno" : "Sin transporte público"}
                      </span>
                    </span>
                    <Link className="naves-fila-mapa" href={enlaceAlMapa(vehicle.id)} title={`Ver ${nombre} en el mapa`}>
                      <span aria-hidden="true" className="naves-fila-mapa-pin" /> Ver en el mapa
                    </Link>
                  </div>

                  <div className="naves-fila-servicio">
                    {enCurso ? (
                      <>
                        <span className="naves-fila-cuando naves-fila-ahora">{hastaCuando(enCurso)}</span>
                        {enCurso.href ? <Link className="naves-fila-que" href={enCurso.href}>{tituloCorto(enCurso)}</Link> : <span className="naves-fila-que">{tituloCorto(enCurso)}</span>}
                      </>
                    ) : senal && !senal.detenido ? (
                      <>
                        <span className="naves-fila-cuando naves-fila-ahora">En movimiento</span>
                        <span className="naves-fila-que">Sin un servicio cargado para esta hora</span>
                      </>
                    ) : proximo && proximoDia ? (
                      <>
                        <span className="naves-fila-cuando">{cuandoSale(proximo, proximoDia, hoyDia)}</span>
                        {proximo.href ? <Link className="naves-fila-que" href={proximo.href}>{tituloCorto(proximo)}</Link> : <span className="naves-fila-que">{tituloCorto(proximo)}</span>}
                      </>
                    ) : (
                      <span className="naves-fila-nada">{vehicle.isActive && vehicle.kind !== "UTILITARIO" ? "Sin servicios próximos" : "—"}</span>
                    )}
                    {senal ? <span className="naves-fila-senal" data-detenida={senal.detenido || undefined}>{senalEnPalabras(senal)}</span> : null}
                  </div>

                  <div className="naves-fila-estado">
                    <span className="pill pill-estado pill-tabla" data-tono={tonoEstado}>{estadoCorto}</span>
                    {alertas.principal ? (
                      <span className="naves-alerta" data-tono={alertas.principal.tono}>
                        {alertas.principal.etiqueta}
                        {alertas.otras > 0 ? <span className="naves-alerta-mas">+{alertas.otras}</span> : null}
                      </span>
                    ) : vehicle.isActive ? (
                      <span className="naves-fila-nada">Sin alertas</span>
                    ) : (
                      <span className="naves-fila-nada">{vehicle.notes ?? "Fuera de la flota"}</span>
                    )}
                    {!vehicle.isActive && serviciosHoy > 0 ? (
                      <span className="naves-alerta" data-tono="grave">Tiene servicios asignados estando fuera de la flota</span>
                    ) : null}
                  </div>

                  <div className="naves-fila-menu">
                    <MenuFila etiqueta={`Más opciones de ${nombre}`}>
                      <Link className="menu-fila-item" href={enlaceAlMapa(vehicle.id)}>Ver en el mapa</Link>
                      {vehicle.isActive && <Link className="menu-fila-item" href={{ pathname: "/admin", query: { date: hoyDia, vista: "flota", recurso: vehicle.id } }}>Agenda de hoy</Link>}
                      <Link className="menu-fila-item" href={ficha}>Ver ficha</Link>
                      <Link className="menu-fila-item" href={`${ficha}/recorridos`}>Recorridos</Link>
                      <Link className="menu-fila-item" href={`${ficha}/vencimientos`}>Vencimientos y seguro</Link>
                      <Link className="menu-fila-item" href={`${ficha}/danios`}>Anotar un daño</Link>
                      <Link className="menu-fila-item" href={`${ficha}/editar`}>Editar nave</Link>
                    </MenuFila>
                  </div>

                  <div className="naves-fila-docs" aria-label="Vencimientos de la unidad">
                    {papeles.map((papel) => (
                      <Link key={papel.tipo} className="naves-doc" data-nivel={papel.nivel} href={`${ficha}/vencimientos`}>
                        <span className="naves-doc-tipo">{papel.tipo}</span>
                        <strong>{formatoFecha(papel.fecha)}</strong>
                        <small>{papel.dias === null ? "Sin fecha" : complianceLabel(papel.fecha, ahora, 30)}</small>
                        {papel.tipo !== "Póliza" && cadencia && cadencia !== "sin habilitación" ? (
                          <small className="naves-doc-cadencia">Cada {cadencia}</small>
                        ) : null}
                      </Link>
                    ))}
                  </div>
                </div>

                <details className="naves-fila-detalle">
                  <summary>Ver toda la data de {nombre}</summary>
                  <dl className="naves-detalle-grid">
                    <Dato rotulo="Estado">{estadoCorto}</Dato>
                    <Dato rotulo="Actividad">{estado.etiqueta}</Dato>
                    <Dato rotulo="Tipo">{vehicle.kind === "UTILITARIO" ? "Utilitario" : vehicle.kind === "BUS" ? "Bus" : "Camioneta"}</Dato>
                    <Dato rotulo="Año">{vehicle.year ?? "Sin dato"}</Dato>
                    <Dato rotulo="Antigüedad">{edad ? `${edad.anios} años${edad.estimada ? " (estimada por año modelo)" : ""}` : "Sin fecha de adquisición"}</Dato>
                    <Dato rotulo="Patente">{vehicle.licensePlate ?? "Sin patente"}</Dato>
                    <Dato rotulo="Lugares">{vehicle.asientos || "Sin cargar"}</Dato>
                    <Dato rotulo="Titular">{vehicle.owner ?? "Sin dato"}</Dato>
                    <Dato rotulo="Seguro">{vehicle.insurer ?? "Sin dato"}</Dato>
                    <Dato rotulo="Habilitación">{vehicle.publicTransport ? "Transporte público" : "No habilitada para pasajeros"}</Dato>
                    <Dato rotulo="Técnica / RTO">{textoCadencia(cadencia)}</Dato>
                    <Dato rotulo="RTO">{formatoFecha(vehicle.rtoDueAt)} · {complianceLabel(vehicle.rtoDueAt, ahora, 30)}</Dato>
                    <Dato rotulo="Técnica">{formatoFecha(vehicle.technicalInspectionDueAt)} · {complianceLabel(vehicle.technicalInspectionDueAt, ahora, 30)}</Dato>
                    <Dato rotulo="Póliza">{formatoFecha(vehicle.policyDueAt)} · {complianceLabel(vehicle.policyDueAt, ahora, 30)}</Dato>
                    <Dato rotulo="Servicios hoy">
                      {serviciosHoy > 0
                        ? `${serviciosHoy} ${serviciosHoy === 1 ? "servicio" : "servicios"}${vehicle.isActive ? "" : " (fuera de servicio)"}`
                        : vehicle.isActive
                          ? "Sin servicios hoy"
                          : "Fuera de servicio"}
                    </Dato>
                    <Dato rotulo="Notas">{vehicle.notes ?? "—"}</Dato>
                  </dl>
                  <div className="naves-detalle-acciones">
                    <Link className="button" href={ficha}>Abrir ficha completa</Link>
                    <Link className="ghost-button" href={`${ficha}/vencimientos`}>Vencimientos</Link>
                    <Link className="ghost-button" href={`${ficha}/recorridos`}>Recorridos</Link>
                    <Link className="ghost-button" href={`${ficha}/danios`}>Daños</Link>
                    <Link className="ghost-button" href={`${ficha}/editar`}>Editar</Link>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {paginador("abajo")}
    </AdminShell>
  );
}
