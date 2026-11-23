import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { MenuFila } from "@/components/admin-list/menu-fila";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { ordenarNaves } from "@/lib/vehicles/fleet-table";
import {
  alertasDeNave,
  coincideBusqueda,
  entraEnPestana,
  estadoDeNave,
  leerPestanaDeFlota,
  type PestanaDeFlota
} from "@/lib/vehicles/estado-en-flota";
import type { Recorrido } from "@/lib/vehicles/ficha";
import { proximoYHoy, type ServicioDeNave } from "@/lib/vehicles/servicio-en-curso";
import { enlaceAlMapa } from "@/lib/vehicles/enlace-mapa";
import { cargarSenalesDeChoferes, cargarServiciosDeLaFlota, type SenalDelChofer } from "./servicios-de-la-flota";
import "./naves.css";

type AdminVehiclesPageProps = {
  searchParams?: Promise<{ notice?: string; q?: string; vista?: string }>;
};

/** Los grupos del tablero, en el orden en que la operación piensa la flota. */
const GRUPOS: Array<{ kind: string; titulo: string }> = [
  { kind: "BUS", titulo: "Buses" },
  { kind: "CAMIONETA", titulo: "Camionetas" },
  { kind: "UTILITARIO", titulo: "Utilitarios" }
];

const PESTANAS: Array<{ id: PestanaDeFlota; etiqueta: string }> = [
  { id: "activas", etiqueta: "Activas" },
  { id: "recorrido", etiqueta: "En recorrido" },
  { id: "alertas", etiqueta: "Con alertas" },
  { id: "taller", etiqueta: "En reparación" },
  { id: "publico", etiqueta: "Transporte público" },
  { id: "inactivas", etiqueta: "No habilitadas" }
];

function pestanaHref(pestana: PestanaDeFlota) {
  return pestana === "activas" ? "/admin/naves" : `/admin/naves?vista=${pestana}`;
}

/** «San Martin de los Andes» ocupa media fila: en el tablero alcanza con «San Martín». */
function lugarCorto(lugar: string) {
  return lugar.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim() === "san martin de los andes" ? "San Martín" : lugar;
}

const horaArgentina = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
const diaCorto = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** «Hoy 10:00» · «Mañana 15:45» · «sáb 28 nov 10:00» (Chapelco, sin hora). */
function cuandoSale(recorrido: Recorrido, dia: string, hoy: string) {
  const manana = new Date(new Date(`${hoy}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const fecha = dia === hoy ? "Hoy" : dia === manana ? "Mañana" : diaCorto.format(new Date(`${dia}T00:00:00Z`)).replace(/\./g, "").replace(",", "");
  return recorrido.soloDia ? fecha : `${fecha} ${horaArgentina.format(recorrido.desde)}`;
}

function tituloCorto(recorrido: Recorrido) {
  return recorrido.titulo.split(" → ").map(lugarCorto).join(" → ");
}

/** «Ahora · hasta 10:15»: el servicio en curso y cuándo termina (llegada, fin del viaje o del reparto). */
function hastaCuando(servicio: ServicioDeNave) {
  return servicio.ventana ? `Ahora · hasta ${horaArgentina.format(servicio.ventana.hasta)}` : "Ahora";
}

/** «Señal del chofer hace 3 min» (la app del chofer manda la ubicación con la nave que maneja). */
function senalEnPalabras(senal: SenalDelChofer) {
  const hace = senal.minutos === 0 ? "recién" : `hace ${senal.minutos} min`;
  return [senal.detenido ? "Detenida" : null, senal.chofer, `señal ${hace}`].filter(Boolean).join(" · ");
}

export default async function AdminVehiclesPage({ searchParams }: AdminVehiclesPageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const ahora = new Date();
  const pestana = leerPestanaDeFlota(params?.vista);
  const busqueda = params?.q?.trim() ?? "";

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
    return { vehicle, estado, alertas, enCurso, senal, proximo, proximoDia: proximo ? diaDe(proximo) : null };
  });

  const cuentas = Object.fromEntries(
    PESTANAS.map(({ id }) => [id, naves.filter((nave) => entraEnPestana(id, nave.vehicle, nave.estado, nave.alertas.principal)).length])
  ) as Record<PestanaDeFlota, number>;
  const visibles = naves.filter(
    (nave) =>
      (busqueda ? true : entraEnPestana(pestana, nave.vehicle, nave.estado, nave.alertas.principal)) &&
      coincideBusqueda(nave.vehicle, busqueda)
  );
  const asientos = visibles.reduce((total, nave) => total + nave.vehicle.asientos, 0);
  const ahoraEnLaCalle = naves.filter((nave) => nave.estado.clave === "en-recorrido" || nave.estado.clave === "en-la-calle" || (nave.vehicle.isActive && nave.enCurso));

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

      <nav className="naves-pestanas" aria-label="Vistas de la flota">
        {PESTANAS.map((item) => (
          <Link
            key={item.id}
            className="naves-pestana"
            href={pestanaHref(item.id)}
            aria-current={pestana === item.id && !busqueda ? "page" : undefined}
            data-alerta={(item.id === "alertas" || item.id === "taller") && cuentas[item.id] > 0 ? true : undefined}
          >
            {item.etiqueta}
            <span className="naves-pestana-cuenta">{cuentas[item.id]}</span>
          </Link>
        ))}
      </nav>

      <p className="naves-resumen" role="status">
        {busqueda ? <>Resultados para «{busqueda}» · </> : null}
        {visibles.length === 0
          ? "No hay naves para mostrar."
          : `${visibles.length} ${visibles.length === 1 ? "nave" : "naves"} · ${asientos} asientos`}
        {busqueda ? <> · <Link href="/admin/naves">Ver todas</Link></> : null}
      </p>

      {/* «Ahora»: qué nave está en recorrido y cuál, de un vistazo y sin entrar a cada una. */}
      {pestana === "activas" && !busqueda && ahoraEnLaCalle.length > 0 ? (
        <section className="naves-ahora" aria-label="Naves en recorrido ahora">
          <h2 className="naves-ahora-titulo">
            <span className="naves-ahora-punto" aria-hidden="true" /> Ahora en la calle <span>{ahoraEnLaCalle.length}</span>
            {/* La página no se actualiza sola: la hora dice de cuándo es el dato. */}
            <span className="naves-ahora-hora">a las {horaArgentina.format(ahora)}</span>
          </h2>
          <ul>
            {ahoraEnLaCalle.map(({ vehicle, enCurso, senal }) => (
              <li key={vehicle.id}>
                <Link
                  href={enlaceAlMapa(vehicle.id)}
                  className="naves-ahora-interno"
                  title={`Ver ${vehicle.internalNumber ? `el interno ${vehicle.internalNumber}` : vehicle.name} en el mapa`}
                >
                  {vehicle.internalNumber ?? vehicle.name}
                </Link>
                {enCurso ? (
                  <>
                    {enCurso.href ? <Link href={enCurso.href}>{tituloCorto(enCurso)}</Link> : <span>{tituloCorto(enCurso)}</span>}
                    {enCurso.ventana ? <span className="naves-ahora-hasta">hasta {horaArgentina.format(enCurso.ventana.hasta)}</span> : null}
                  </>
                ) : (
                  <span className="naves-ahora-sin">Sin servicio cargado</span>
                )}
                {senal ? (
                  <span className="naves-ahora-senal" data-detenida={senal.detenido || undefined}>{senalEnPalabras(senal)}</span>
                ) : (
                  // Programado pero sin señal: puede que el chofer no tenga la app abierta. Se dice, no se supone.
                  <span className="naves-ahora-hasta">sin señal del chofer</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {GRUPOS.map((grupo) => {
        const delGrupo = visibles.filter((nave) => (GRUPOS.some((g) => g.kind === nave.vehicle.kind) ? nave.vehicle.kind : "CAMIONETA") === grupo.kind);
        if (delGrupo.length === 0) return null;
        return (
          <section className="naves-grupo" key={grupo.kind} aria-label={grupo.titulo}>
            <h2 className="naves-grupo-titulo">
              {grupo.titulo} <span>{delGrupo.length}</span>
            </h2>
            <ul className="naves-lista">
              {delGrupo.map(({ vehicle, estado, alertas, enCurso, senal, proximo, proximoDia }) => {
                const ficha = `/admin/naves/${vehicle.id}`;
                const nombre = vehicle.internalNumber ? `Interno ${vehicle.internalNumber}` : vehicle.name;
                return (
                  <li key={vehicle.id} className="naves-fila" data-tono={estado.tono === "grave" ? "grave" : alertas.principal?.tono === "grave" ? "grave" : undefined} data-inactiva={!vehicle.isActive || undefined}>
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
                      <Link className="naves-fila-mapa" href={enlaceAlMapa(vehicle.id)} title={`Ver ${nombre} en el mapa`}>
                        <span aria-hidden="true" className="naves-fila-mapa-pin" /> Ver en el mapa
                      </Link>
                      <span className="naves-fila-extra">
                        <span className="naves-fila-patente">{vehicle.licensePlate ?? "sin patente"}</span>
                        {vehicle.year ? <span>{vehicle.year}</span> : null}
                        {vehicle.asientos > 0 ? <span>{vehicle.asientos} asientos</span> : null}
                        {vehicle.publicTransport ? <span className="naves-fila-tp" title="Transporte público (asegurada en Prot Mut)">Transporte público</span> : null}
                      </span>
                    </div>
                    <div className="naves-fila-servicio">
                      {enCurso ? (
                        <>
                          <span className="naves-fila-cuando naves-fila-ahora">{hastaCuando(enCurso)}</span>
                          {enCurso.href ? (
                            <Link className="naves-fila-que" href={enCurso.href}>{tituloCorto(enCurso)}</Link>
                          ) : (
                            <span className="naves-fila-que">{tituloCorto(enCurso)}</span>
                          )}
                        </>
                      ) : senal && !senal.detenido ? (
                        <>
                          <span className="naves-fila-cuando naves-fila-ahora">En movimiento</span>
                          <span className="naves-fila-que">Sin un servicio cargado para esta hora</span>
                        </>
                      ) : proximo && proximoDia ? (
                        <>
                          <span className="naves-fila-cuando">{cuandoSale(proximo, proximoDia, hoyDia)}</span>
                          {proximo.href ? (
                            <Link className="naves-fila-que" href={proximo.href}>{tituloCorto(proximo)}</Link>
                          ) : (
                            <span className="naves-fila-que">{tituloCorto(proximo)}</span>
                          )}
                        </>
                      ) : (
                        <span className="naves-fila-nada">{vehicle.isActive && vehicle.kind !== "UTILITARIO" ? "Sin servicios próximos" : "—"}</span>
                      )}
                      {senal ? <span className="naves-fila-senal" data-detenida={senal.detenido || undefined}>{senalEnPalabras(senal)}</span> : null}
                    </div>
                    <div className="naves-fila-estado">
                      <span className="pill pill-estado pill-tabla" data-tono={estado.tono}>{estado.etiqueta}</span>
                    </div>
                    <div className="naves-fila-alerta">
                      {alertas.principal ? (
                        <>
                          <span className="naves-alerta" data-tono={alertas.principal.tono}>{alertas.principal.etiqueta}</span>
                          {alertas.otras > 0 ? (
                            <span className="naves-alerta-mas" title="Hay más cosas para revisar en la ficha">+{alertas.otras}</span>
                          ) : null}
                        </>
                      ) : vehicle.isActive ? (
                        <span className="naves-fila-nada">Papeles al día</span>
                      ) : (
                        <span className="naves-fila-nada">{vehicle.notes ?? "Fuera de la flota"}</span>
                      )}
                    </div>
                    <div className="naves-fila-menu">
                      <MenuFila etiqueta={`Más opciones de ${nombre}`}>
                        {vehicle.isActive && <Link className="menu-fila-item" href={{ pathname: "/admin", query: { date: hoyDia, vista: "flota", recurso: vehicle.id } }}>Agenda de hoy</Link>}
                        <Link className="menu-fila-item" href={enlaceAlMapa(vehicle.id)}>Ver en el mapa</Link>
                        <Link className="menu-fila-item" href={ficha}>Ver ficha</Link>
                        <Link className="menu-fila-item" href={`${ficha}/recorridos`}>Recorridos</Link>
                        <Link className="menu-fila-item" href={`${ficha}/vencimientos`}>Vencimientos y seguro</Link>
                        <Link className="menu-fila-item" href={`${ficha}/danios`}>Anotar un daño</Link>
                        <Link className="menu-fila-item" href={`${ficha}/editar`}>Editar nave</Link>
                      </MenuFila>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </AdminShell>
  );
}
