import Link from "next/link";
import type { NaveEnVivo } from "@/lib/driver/en-vivo";
import { fechaLocal, minutosAHoras } from "@/lib/driver/jornada";
import { AVISO_PREVIO_MINUTOS, type ResumenDeServicios } from "@/lib/driver/servicios";

/**
 * Servicios del día cruzados con la unidad asignada.
 *
 * El tablero de salidas dice qué hay que cubrir; esto dice si la unidad que lo cubre está viva. Se
 * ordena por urgencia, no por hora: lo primero que se ve es lo que hay que resolver ahora.
 */

const AREA = { RUTA: "Ruta", AEROPUERTO: "Aeropuerto", CHAPELCO: "Chapelco", ESPECIAL: "Especial" } as const;

const NIVEL = {
  "sin-unidad": { clase: "es-riesgo", etiqueta: "Sin nave" },
  "en-riesgo": { clase: "es-riesgo", etiqueta: "En riesgo" },
  "en-curso": { clase: "es-curso", etiqueta: "En curso" },
  atencion: { clase: "es-atencion", etiqueta: "Atención" },
  listo: { clase: "es-listo", etiqueta: "Listo" },
  futuro: { clase: "es-futuro", etiqueta: "Más tarde" },
  pasado: { clase: "es-pasado", etiqueta: "Finalizado" }
} as const;

function hora(fecha: Date | string | null) {
  if (!fecha) return "—";
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires"
  });
}

function faltan(minutos: number | null, enCurso: boolean, tieneNave: boolean) {
  if (enCurso) return tieneNave ? "en viaje" : "en horario";
  if (minutos == null) return "";
  if (minutos < -1) return `hace ${minutosAHoras(Math.abs(minutos))}`;
  if (minutos <= 1) return "ahora";
  return `en ${minutosAHoras(minutos)}`;
}

function Punto({ estado }: { estado: NaveEnVivo["estado"] | "sin-posicion" }) {
  const clase = estado === "sin-posicion" ? "sin-posicion" : estado;
  return <span className={`srv-punto is-${clase}`} aria-hidden="true" />;
}

export function ServiciosDelDia({
  resumen,
  fecha,
  hoy
}: {
  resumen: ResumenDeServicios;
  fecha: string;
  hoy?: string;
}) {
  const hoyKey = hoy ?? fechaLocal(new Date());
  const mananaKey = fechaLocal(new Date(Date.parse(`${hoyKey}T12:00:00Z`) + 86_400_000));
  const ayerKey = fechaLocal(new Date(Date.parse(`${hoyKey}T12:00:00Z`) - 86_400_000));

  const pendientes = resumen.evaluados.filter((servicio) => servicio.nivel !== "pasado");
  const pasados = resumen.evaluados.filter((servicio) => servicio.nivel === "pasado");
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const fechaLinda = new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC"
  });

  return (
    <section className="srv" aria-labelledby="srv-titulo">
      <div className="srv-barra">
        <div>
          <h2 id="srv-titulo">Servicios del día</h2>
          <p className="srv-fecha">{fechaLinda.charAt(0).toUpperCase() + fechaLinda.slice(1)}</p>
        </div>

        <div className="srv-controles">
          <div className="dia-chips srv-chips" role="group" aria-label="Día de servicios">
            <Link
              className="dia-chip"
              href={`/admin/naves/en-vivo?vista=servicios&fecha=${ayerKey}`}
              aria-current={fecha === ayerKey ? "true" : undefined}
            >
              Ayer
            </Link>
            <Link
              className="dia-chip"
              href={`/admin/naves/en-vivo?vista=servicios&fecha=${hoyKey}`}
              aria-current={fecha === hoyKey ? "true" : undefined}
            >
              Hoy
            </Link>
            <Link
              className="dia-chip"
              href={`/admin/naves/en-vivo?vista=servicios&fecha=${mananaKey}`}
              aria-current={fecha === mananaKey ? "true" : undefined}
            >
              Mañana
            </Link>
          </div>

          <form className="dia-buscar" method="get" action="/admin/naves/en-vivo">
            <input type="hidden" name="vista" value="servicios" />
            <label htmlFor="srv-fecha-input">Fecha</label>
            <input id="srv-fecha-input" type="date" name="fecha" defaultValue={fecha} />
            <button type="submit" className="ghost-button">Ver</button>
          </form>
        </div>
      </div>

      <div className="srv-kpis" role="status">
        <span>
          <strong>{resumen.total}</strong> servicios en el día
        </span>
        <span className={resumen.enRiesgo > 0 ? "srv-num-alerta" : "srv-num-ok"}>
          {resumen.enRiesgo} {resumen.enRiesgo === 1 ? "en riesgo o sin nave" : "en riesgo o sin nave"}
        </span>
        {resumen.enCurso > 0 ? (
          <span className="srv-num-curso">{resumen.enCurso} en curso</span>
        ) : null}
        <span className="srv-num-ok">{resumen.listos} listos</span>
        <span className="srv-num-pasados">{resumen.finalizados} finalizados</span>
      </div>

      <p className="srv-nota">
        Se marca «en riesgo» o «sin nave» cuando al servicio le faltan {AVISO_PREVIO_MINUTOS} minutos o menos (o ya
        está en horario) y su nave no reporta, está detenida o no tiene posición. Los servicios que están dentro de
        su ventana de viaje aparecen arriba como «en curso».
      </p>

      {pendientes.length === 0 ? (
        <p className="srv-vacio">
          {resumen.total === 0
            ? "No hay servicios cargados para ese día."
            : `Los ${resumen.total} servicios de ese día ya finalizaron. Abajo están con su nave asignada.`}
        </p>
      ) : (
        <ul className="srv-lista">
          {pendientes.map((servicio) => (
            <li key={servicio.id} className={`srv-fila ${NIVEL[servicio.nivel].clase}`}>
              <div className="srv-hora">
                <strong>{hora(servicio.at)}</strong>
                <span>{faltan(servicio.minutosParaSalir, servicio.enCurso, servicio.unidades.length > 0)}</span>
              </div>

              <div className="srv-servicio">
                <p className="srv-tags">
                  <span className="srv-area">{AREA[servicio.area]}</span>
                  <span className="srv-nivel">{NIVEL[servicio.nivel].etiqueta}</span>
                  <span className="srv-pax">
                    {servicio.pasajeros > 0 ? `${servicio.pasajeros} pas.` : "0 reservas"}
                  </span>
                </p>
                <Link href={servicio.href} className="srv-titulo">{servicio.titulo}</Link>
                {servicio.detalle ? <span className="srv-detalle"> · {servicio.detalle}</span> : null}
              </div>

              <div className="srv-unidades">
                {servicio.unidades.length === 0 ? (
                  <Link className="srv-asignar" href={servicio.href}>Asignar nave</Link>
                ) : (
                  servicio.unidades.map((unidad) => {
                    const estado = servicio.estados.find((item) => item.vehicleId === unidad.vehicleId);
                    return (
                      <span key={unidad.vehicleId} className="srv-unidad">
                        <Punto estado={estado?.estado ?? "sin-posicion"} />
                        <Link
                          href={`/admin/naves/en-vivo?unidad=${encodeURIComponent(unidad.vehicleId)}`}
                          className="srv-unidad-nombre"
                          title="Centrar esta unidad en el mapa en vivo"
                        >
                          {unidad.internalNumber ? `Interno ${unidad.internalNumber}` : unidad.vehicleName}
                        </Link>
                        {unidad.driverName ? <span className="srv-chofer">· {unidad.driverName}</span> : null}
                        {estado?.recordedAt ? (
                          <span className="srv-ultima-senal">(últ. {hora(estado.recordedAt)})</span>
                        ) : null}
                      </span>
                    );
                  })
                )}
              </div>

              <div className="srv-derecha">
                <p className="srv-motivo">{servicio.motivo}</p>
                {servicio.unidades.length > 0 ? (
                  <Link
                    href={`/admin/naves/en-vivo?unidad=${encodeURIComponent(servicio.unidades[0].vehicleId)}`}
                    className="srv-ver-mapa"
                  >
                    Ver en mapa
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pasados.length > 0 ? (
        <details className="srv-pasados">
          <summary>
            {pasados.length} {pasados.length === 1 ? "servicio que ya finalizó" : "servicios que ya finalizaron"}
          </summary>
          <ul className="srv-lista">
            {pasados.map((servicio) => (
              <li key={servicio.id} className="srv-fila es-pasado">
                <div className="srv-hora">
                  <strong>{hora(servicio.at)}</strong>
                  <span>{faltan(servicio.minutosParaSalir, false, servicio.unidades.length > 0)}</span>
                </div>
                <div className="srv-servicio">
                  <p className="srv-tags">
                    <span className="srv-area">{AREA[servicio.area]}</span>
                    <span className="srv-pax">
                      {servicio.pasajeros > 0 ? `${servicio.pasajeros} pas.` : "0 reservas"}
                    </span>
                  </p>
                  <Link href={servicio.href} className="srv-titulo">{servicio.titulo}</Link>
                </div>
                <div className="srv-unidades">
                  {servicio.unidades.length === 0 ? (
                    <span className="muted">sin nave registrada</span>
                  ) : (
                    servicio.unidades.map((unidad) => (
                      <span key={unidad.vehicleId} className="srv-unidad">
                        <span className="srv-unidad-nombre">
                          {unidad.internalNumber ? `Interno ${unidad.internalNumber}` : unidad.vehicleName}
                        </span>
                        {unidad.driverName ? <span className="srv-chofer">· {unidad.driverName}</span> : null}
                      </span>
                    ))
                  )}
                </div>
                <div className="srv-derecha">
                  <p className="srv-motivo">{servicio.motivo}</p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
