import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { EXPIRY_LABELS, expiryDaysLabel, expiryStatus, todayInArgentina, worstStatus, type ExpiryStatus } from "@/lib/admin/driver-documents";
import { getCurrentDriverManagerOrRedirect } from "@/lib/auth/admin";
import { roleCanAccess } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { cargarServiciosDelDia } from "@/lib/driver/cargar-servicios-del-dia";
import {
  ETIQUETA_AREA, LINEA_DESDE_HORA, LINEA_HASTA_HORA, PESTANAS_CHOFERES, bloqueEnLinea, carriles, enCurso, entraEnPestanaChoferes, limitesDeLinea,
  horasDeLaJornada, iniciales, jornadaDe, leerPestanaChoferes, navesDeLaJornada, proximo, type PestanaChoferes, type ServicioDelDia
} from "@/lib/driver/tablero-choferes";
import { tituloDeNave } from "@/lib/fleet/titulo-de-nave";
import { isDateKey, localDateKey, shiftDateKey } from "@/lib/operations/day-board";
import { HoraDeAhora, MarcaDeAhora, TableroConReloj } from "./reloj-del-tablero";
import { AsignarJornada, type ChoferVista, type ServicioVista } from "./asignar-jornada";
import { AsignarViaje } from "./asignar-viaje";
import "./choferes.css";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const NOMBRE_PESTANA: Record<PestanaChoferes, string> = {
  trabajan: "Trabajan",
  libres: "Libres",
  documentacion: "Documentación",
  todos: "Todos",
  inactivos: "Inactivos"
};

/** Mismo orden que la línea: el color no alcanza si no hay leyenda. */
const AREAS_LEYENDA = ["SERVICIO_PUBLICO", "AEROPUERTO", "VIAJE_ESPECIAL", "CONCESION", "CHAPELCO"] as const;

const hora = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });
const diaLargo = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const diaCorto = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** Una señal de la app del chofer de hace menos de esto cuenta como «en vivo». */
const SENAL_VIVA_MS = 15 * 60_000;

const sinTildes = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const horario = (servicio: Pick<ServicioDelDia, "desde" | "hasta" | "turno">) => servicio.turno ?? `${hora.format(servicio.desde)}–${hora.format(servicio.hasta)}`;
const horas = (valor: number) => `${valor.toLocaleString("es-AR", { maximumFractionDigits: 1 })} h`;

/**
 * Choferes como tablero del día (rediseño del 24-nov). Antes era la planilla de cuentas filtrada a
 * chofer: nombre, email, DNI y vencimientos. Ahora la pregunta es la de la operación —¿quién maneja
 * qué hoy, y con qué nave?— y la respuesta está en una línea del día por chofer, con un gesto para
 * asignarle un viaje y su nave. Los papeles siguen a la vista, como una marca en cada chofer y una
 * pestaña para lo que hay que renovar.
 *
 * Lo ve la secretaría (sólo mirar); asignar es de administración, igual que el chofer de una salida.
 */
export default async function ChoferesPage({ searchParams }: Props) {
  const usuario = await getCurrentDriverManagerOrRedirect();
  const puedeAsignar = roleCanAccess(usuario.role, ["ADMIN"]);
  const params = (await searchParams) ?? {};
  const texto = (clave: string) => (typeof params[clave] === "string" ? (params[clave] as string) : "");
  const hoy = localDateKey(new Date());
  const dia = isDateKey(texto("dia")) ? texto("dia") : hoy;
  const esHoy = dia === hoy;
  const pestana = leerPestanaChoferes(texto("vista") || undefined);
  const buscar = texto("q").trim();
  const ahora = new Date();

  const [choferes, servicios, vehiculos, senales] = await Promise.all([
    prisma.user.findMany({
      where: { role: "DRIVER" },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: {
        id: true, name: true, email: true, isActive: true,
        driverProfile: { select: { licenseCategory: true, licenseExpiresAt: true, criminalRecordExpiresAt: true } }
      }
    }),
    cargarServiciosDelDia(dia),
    prisma.vehicle.findMany({
      select: { id: true, name: true, internalNumber: true }
    }),
    esHoy
      ? prisma.driverVehicleLocation.findMany({
          where: { recordedAt: { gte: new Date(ahora.getTime() - SENAL_VIVA_MS) } },
          select: { driverId: true, vehicleId: true, recordedAt: true, isStopped: true }
        })
      : Promise.resolve([])
  ]);

  const naveDe = new Map(vehiculos.map((vehiculo) => [vehiculo.id, vehiculo]));
  const tituloNave = (id: string) => {
    const nave = naveDe.get(id);
    return nave ? tituloDeNave(nave) : "Nave";
  };
  const senalDe = new Map(senales.map((senal) => [senal.driverId, senal]));
  const nombreDe = new Map(choferes.map((chofer) => [chofer.id, chofer.name?.trim() || chofer.email]));
  const hoyAr = todayInArgentina();

  const filas = choferes.map((chofer) => {
    const jornada = jornadaDe(chofer.id, servicios);
    const licencia = expiryStatus(chofer.driverProfile?.licenseExpiresAt, hoyAr);
    const antecedentes = expiryStatus(chofer.driverProfile?.criminalRecordExpiresAt, hoyAr);
    const papeles = worstStatus([licencia, antecedentes]);
    return {
      chofer, jornada, licencia, antecedentes, papeles,
      nombre: nombreDe.get(chofer.id)!,
      naves: navesDeLaJornada(jornada),
      senal: senalDe.get(chofer.id) ?? null
    };
  });
  const enPestana = (fila: (typeof filas)[number], cual: PestanaChoferes) =>
    entraEnPestanaChoferes(cual, { isActive: fila.chofer.isActive, servicios: fila.jornada.length, documentacionEnOrden: fila.papeles === "VALID" });
  const buscadas = buscar ? filas.filter((fila) => sinTildes(`${fila.nombre} ${fila.chofer.email}`).includes(sinTildes(buscar))) : filas;
  const cuentas = Object.fromEntries(PESTANAS_CHOFERES.map((cual) => [cual, buscadas.filter((fila) => enPestana(fila, cual)).length])) as Record<PestanaChoferes, number>;
  const visibles = buscadas
    .filter((fila) => enPestana(fila, pestana))
    .sort((a, b) => (a.jornada[0]?.desde.getTime() ?? Infinity) - (b.jornada[0]?.desde.getTime() ?? Infinity) || a.nombre.localeCompare(b.nombre, "es"));

  // Lo que la operación tiene que resolver: naves con servicios sin chofer ese día.
  const sinChofer = [...new Set(servicios.filter((s) => s.asignableDesdeChoferes && !s.driverId).map((s) => s.vehicleId))]
    .map((vehicleId) => ({ vehicleId, pendientes: servicios.filter((s) => s.vehicleId === vehicleId && s.asignableDesdeChoferes && !s.driverId).sort((a, b) => +a.desde - +b.desde) }))
    .sort((a, b) => +a.pendientes[0].desde - +b.pendientes[0].desde);
  const serviciosSinChofer = sinChofer.reduce((total, nave) => total + nave.pendientes.length, 0);

  // Para el modal: los servicios y las naves y choferes que se pueden elegir.
  const serviciosVista: ServicioVista[] = servicios.map((s) => ({
    clave: s.clave, area: s.area, vehicleId: s.vehicleId, driverId: s.driverId, desde: s.desde.getTime(), hasta: s.hasta.getTime(),
    horario: horario(s), titulo: s.titulo, asignable: s.asignableDesdeChoferes
  }));
  const choferesVista: ChoferVista[] = filas
    .filter((fila) => fila.chofer.isActive)
    .map((fila) => ({ id: fila.chofer.id, nombre: fila.nombre, iniciales: iniciales(fila.chofer.name, fila.chofer.email) }));
  const fechaTexto = diaCorto.format(new Date(`${dia}T12:00:00Z`));

  const enlace = (cambios: Record<string, string | null>) => {
    const siguiente = new URLSearchParams();
    const base = { dia: dia === hoy ? null : dia, vista: pestana === "trabajan" ? null : pestana, q: buscar || null, ...cambios };
    for (const [clave, valor] of Object.entries(base)) if (valor) siguiente.set(clave, valor);
    const consulta = siguiente.toString();
    return `/admin/choferes${consulta ? `?${consulta}` : ""}`;
  };

  const limitesDelDia = limitesDeLinea(dia);
  const horasDeLinea = Array.from({ length: (LINEA_HASTA_HORA - LINEA_DESDE_HORA) / 3 + 1 }, (_, i) => LINEA_DESDE_HORA + 1 + i * 3).filter((h) => h < LINEA_HASTA_HORA);

  return (
    <AdminShell
      role={usuario.role}
      title="Choferes"
      eyebrow="Operación"
      notice={texto("notice") || undefined}
      action={<Link className="button" href="/admin/choferes/nueva">Crear chofer</Link>}
    >
      <TableroConReloj activo={esHoy} inicio={limitesDelDia.inicio} fin={limitesDelDia.fin} ahoraInicial={ahora.getTime()}>
      <nav className="choferes-dia" aria-label="Día">
        <Link className="choferes-dia-flecha" href={enlace({ dia: shiftDateKey(dia, -1) })} aria-label="Día anterior">‹</Link>
        <div className="choferes-dia-texto">
          <strong>{diaLargo.format(new Date(`${dia}T12:00:00Z`))}</strong>
          <span>{esHoy ? <>Hoy<HoraDeAhora antes=" · " /></> : dia === shiftDateKey(hoy, 1) ? "Mañana" : dia === shiftDateKey(hoy, -1) ? "Ayer" : dia.split("-").reverse().join("/")}</span>
        </div>
        <Link className="choferes-dia-flecha" href={enlace({ dia: shiftDateKey(dia, 1) })} aria-label="Día siguiente">›</Link>
        {!esHoy ? <Link className="ghost-button choferes-dia-hoy" href={enlace({ dia: null })}>Volver a hoy</Link> : null}
        <form className="choferes-dia-elegir" method="get" action="/admin/choferes">
          {pestana !== "trabajan" ? <input type="hidden" name="vista" value={pestana} /> : null}
          <label className="sr-only" htmlFor="choferes-fecha">Ir a otro día</label>
          <input id="choferes-fecha" type="date" name="dia" defaultValue={dia} />
          <button className="ghost-button" type="submit">Ir</button>
        </form>
      </nav>

      <section className="choferes-cifras" aria-label="Resumen del día">
        <Link href={enlace({ vista: null })} className="choferes-cifra">
          <strong>{cuentas.trabajan}</strong><span>{cuentas.trabajan === 1 ? "chofer trabaja" : "choferes trabajan"}</span>
        </Link>
        <Link href={enlace({ vista: "libres" })} className="choferes-cifra">
          <strong>{cuentas.libres}</strong><span>{cuentas.libres === 1 ? "libre" : "libres"}</span>
        </Link>
        <a href="#sin-chofer" className="choferes-cifra" data-alerta={serviciosSinChofer ? "" : undefined}>
          <strong>{serviciosSinChofer}</strong><span>{serviciosSinChofer === 1 ? "servicio sin chofer" : "servicios sin chofer"}</span>
        </a>
        <Link href={enlace({ vista: "documentacion" })} className="choferes-cifra" data-alerta={cuentas.documentacion ? "" : undefined}>
          <strong>{cuentas.documentacion}</strong><span>con papeles para revisar</span>
        </Link>
      </section>

      {sinChofer.length ? (
        <section className="choferes-sin-chofer" id="sin-chofer" aria-labelledby="sin-chofer-titulo">
          <h2 id="sin-chofer-titulo">Naves con servicios sin chofer</h2>
          <ul role="list">
            {sinChofer.map(({ vehicleId, pendientes }) => (
              <li key={vehicleId}>
                <div>
                  <strong>{tituloNave(vehicleId)}</strong>
                  <span>{pendientes.map((s) => `${hora.format(s.desde)} ${s.titulo}`).join(" · ")}</span>
                </div>
                {puedeAsignar ? (
                  <AsignarJornada
                    dia={dia} diaTexto={fechaTexto} servicios={serviciosVista} tituloNave={tituloNave(vehicleId)} choferes={choferesVista}
                    vehicleId={vehicleId} trigger="Asignar chofer" triggerClassName="button choferes-asignar"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form className="choferes-buscar" method="get" action="/admin/choferes" role="search">
        {dia !== hoy ? <input type="hidden" name="dia" value={dia} /> : null}
        {pestana !== "trabajan" ? <input type="hidden" name="vista" value={pestana} /> : null}
        <label className="sr-only" htmlFor="choferes-q">Buscar chofer</label>
        <input id="choferes-q" type="search" name="q" defaultValue={buscar} placeholder="Buscar por nombre o email" />
        <button className="button" type="submit">Buscar</button>
      </form>

      <nav className="choferes-pestanas" aria-label="Filtrar choferes">
        {PESTANAS_CHOFERES.map((cual) => (
          <Link
            key={cual}
            className="choferes-pestana"
            href={enlace({ vista: cual === "trabajan" ? null : cual })}
            aria-current={cual === pestana ? "page" : undefined}
            data-alerta={cual === "documentacion" && cuentas.documentacion ? "" : undefined}
          >
            {NOMBRE_PESTANA[cual]} <span className="choferes-pestana-cuenta">{cuentas[cual]}</span>
          </Link>
        ))}
      </nav>

      <div className="choferes-leyenda" aria-label="Color por tipo de servicio">
        <span className="choferes-leyenda-rotulo">Color por servicio</span>
        {AREAS_LEYENDA.map((area) => (
          <span key={area} className="choferes-leyenda-item">
            <i data-area={area} aria-hidden />
            {ETIQUETA_AREA[area]}
          </span>
        ))}
      </div>

      <div className="choferes-regla" aria-hidden>
        <span />
        <div className="choferes-regla-horas">
          {horasDeLinea.map((h) => (
            <span key={h} style={{ left: `${((h - LINEA_DESDE_HORA) / (LINEA_HASTA_HORA - LINEA_DESDE_HORA)) * 100}%` }}>{String(h).padStart(2, "0")}</span>
          ))}
          <MarcaDeAhora />
        </div>
      </div>

      <ul className="choferes-lista" role="list">
        {visibles.map((fila) => {
          const { chofer, jornada, naves, senal } = fila;
          const actual = esHoy ? enCurso(jornada, ahora) : null;
          const siguiente = esHoy ? proximo(jornada, ahora) : null;
          const lineas = carriles(jornada);
          const papelesTexto = papelesEnPalabras(fila.licencia, fila.antecedentes, chofer.driverProfile, hoyAr);
          return (
            <li key={chofer.id} className="chofer" data-inactivo={!chofer.isActive || undefined}>
              <Link className="chofer-quien" href={`/admin/choferes/${chofer.id}/actividad?dia=${dia}`} aria-label={fila.nombre} prefetch={false}>
                <span className="chofer-avatar" aria-hidden data-tono={actual ? "curso" : jornada.length ? "ok" : "calmo"}>
                  {iniciales(chofer.name, chofer.email)}
                </span>
                <div className="chofer-nombre">
                  <strong>{fila.nombre}</strong>
                  <span className="chofer-estado">
                    {!chofer.isActive
                      ? "Inactivo"
                      : actual
                        ? <><b data-tono="curso">Manejando</b> {actual.titulo} · {tituloNave(actual.vehicleId)}</>
                        : siguiente
                          ? <>Próximo {siguiente.turno ?? hora.format(siguiente.desde)} · {siguiente.titulo}</>
                          : jornada.length === 1
                            ? <>{esHoy ? "Terminó" : "1 servicio"} · {horas(horasDeLaJornada(jornada))} · {jornada[0].titulo}</>
                            : jornada.length
                              ? <>{esHoy ? "Terminó" : `${jornada.length} servicios`} · {horas(horasDeLaJornada(jornada))}</>
                              : esHoy ? "Libre hoy" : "Libre ese día"}
                  </span>
                </div>
                <span className="chofer-papeles" data-estado={fila.papeles} title={papelesTexto}>
                  {chofer.driverProfile ? `Lic. ${chofer.driverProfile.licenseCategory}` : "Sin papeles"}
                  {fila.papeles !== "VALID" ? ` · ${EXPIRY_LABELS[fila.papeles].toLowerCase()}` : ""}
                </span>
              </Link>

              <div className="chofer-linea" role="img" aria-label={jornada.length ? `Servicios: ${jornada.map((s) => `${horario(s)} ${s.titulo}`).join("; ")}` : "Sin servicios"}>
                {horasDeLinea.map((h) => (
                  <i key={h} className="chofer-linea-marca" data-hora={String(h).padStart(2, "0")} style={{ left: `${((h - LINEA_DESDE_HORA) / (LINEA_HASTA_HORA - LINEA_DESDE_HORA)) * 100}%` }} />
                ))}
                {jornada.map((servicio) => {
                  const bloque = bloqueEnLinea(servicio, dia);
                  if (!bloque) return null;
                  const cubreElDia = bloque.izquierda <= 0.5 && bloque.ancho >= 99.5;
                  const muestraTitulo = bloque.ancho >= 18;
                  return (
                    <Link
                      key={servicio.clave}
                      href={servicio.href}
                      className="chofer-bloque"
                      data-area={servicio.area}
                      data-ahora={actual?.clave === servicio.clave || undefined}
                      data-larga={cubreElDia || undefined}
                      style={{
                        // Para el avance y el «ya terminó» (ver reloj-del-tablero): números sin unidad.
                        ["--izq" as string]: bloque.izquierda,
                        ["--ancho" as string]: bloque.ancho,
                        left: `${bloque.izquierda}%`,
                        width: `${bloque.ancho}%`,
                        top: `calc(4px + (100% - 8px) * ${lineas.carril.get(servicio.clave) ?? 0} / ${lineas.total})`,
                        height: `calc((100% - 8px) / ${lineas.total} - ${lineas.total > 1 ? 1 : 0}px)`
                      }}
                      title={`${horario(servicio)} · ${ETIQUETA_AREA[servicio.area]} · ${servicio.titulo} · ${tituloNave(servicio.vehicleId)}`}
                      aria-label={`${horario(servicio)} · ${ETIQUETA_AREA[servicio.area]} · ${servicio.titulo} · ${tituloNave(servicio.vehicleId)}`}
                    >
                      <span className="chofer-bloque-hora">{servicio.turno ?? (cubreElDia ? "Todo el día" : hora.format(servicio.desde))}</span>
                      {cubreElDia ? <span className="chofer-bloque-area">{ETIQUETA_AREA[servicio.area]}</span> : null}
                      {muestraTitulo ? <span className="chofer-bloque-titulo">{servicio.titulo}</span> : null}
                    </Link>
                  );
                })}
              </div>

              <div className="chofer-pie">
                <div className="chofer-naves">
                  {naves.map((id) => (
                    <span key={id} className="chofer-nave" data-gps={senal?.vehicleId === id || undefined}>
                      {tituloNave(id)}
                      <small>{jornada.filter((s) => s.vehicleId === id).length}</small>
                    </span>
                  ))}
                  {senal && !naves.includes(senal.vehicleId) ? (
                    <span className="chofer-nave" data-gps>{tituloNave(senal.vehicleId)} <small>señal</small></span>
                  ) : null}
                  {senal ? (
                    <span className="chofer-senal" title={`Última señal ${hora.format(senal.recordedAt)}`}>
                      {senal.isStopped ? "Detenido" : "En movimiento"} · {Math.max(1, Math.round((ahora.getTime() - senal.recordedAt.getTime()) / 60_000))} min
                    </span>
                  ) : null}
                </div>
                <div className="chofer-acciones">
                  {puedeAsignar && chofer.isActive && jornada.length === 0 && (
                    <AsignarViaje origen="listado" dia={dia} fechaTexto={fechaTexto} driverId={chofer.id} nombre={fila.nombre} />
                  )}
                  {(jornada.length > 0 || !chofer.isActive) && <Link className="button choferes-asignar" href={`/admin/choferes/${chofer.id}/ordenes?fecha=${dia}`} prefetch={false}>
                    Ver hoja de ruta
                  </Link>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {!visibles.length ? (
        <p className="choferes-vacio">
          {buscar
            ? `Ningún chofer coincide con «${buscar}».`
            : pestana === "trabajan"
              ? <>Nadie tiene servicios asignados {esHoy ? "hoy" : "ese día"}. <Link href={enlace({ vista: "libres" })}>Ver los choferes libres</Link></>
              : pestana === "documentacion" ? "Todos los choferes activos tienen los papeles al día." : "No hay choferes en esta vista."}
        </p>
      ) : null}
      </TableroConReloj>
    </AdminShell>
  );
}

function papelesEnPalabras(
  licencia: ExpiryStatus,
  antecedentes: ExpiryStatus,
  perfil: { licenseExpiresAt: Date; criminalRecordExpiresAt: Date } | null,
  hoy: string
) {
  if (!perfil) return "Faltan DNI, licencia y antecedentes";
  const parte = (nombre: string, estado: ExpiryStatus, fecha: Date) => `${nombre}: ${EXPIRY_LABELS[estado].toLowerCase()} (${expiryDaysLabel(fecha, hoy) ?? "sin fecha"})`;
  return `${parte("Licencia", licencia, perfil.licenseExpiresAt)} · ${parte("Antecedentes", antecedentes, perfil.criminalRecordExpiresAt)}`;
}
