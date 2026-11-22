import Link from "next/link";
import { fechaLocal, LIMITE_VELOCIDAD_KMH, minutosAHoras, PARADA_MINIMA_MINUTOS } from "@/lib/driver/jornada";
import type { DiaDeFlota } from "@/lib/driver/dia";

/**
 * Resumen del día por unidad: lo que el dueño mira al cerrar la jornada y lo que se factura.
 *
 * Todo sale del historial de posiciones que ya escribe la app del chofer — no hay tabla nueva ni
 * proceso en background. La pantalla es un server component: no necesita refresco porque el día
 * cerrado no cambia, y el que está en curso se actualiza al recargar.
 */

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires"
  });
}

function diaLindo(fecha: string) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const texto = new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC"
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const SEVERIDAD = { alta: "es-alta", media: "es-media", baja: "es-baja" } as const;
const NIVEL = { alta: "Crítica", media: "Atención", baja: "Aviso" } as const;

export function ResumenDelDia({
  dia,
  dias,
  hoy
}: {
  dia: DiaDeFlota;
  dias: string[];
  hoy: string;
}) {
  const ayer = fechaLocal(new Date(Date.parse(`${hoy}T12:00:00Z`) - 86_400_000));
  const chips = [
    { fecha: hoy, label: "Hoy" },
    { fecha: ayer, label: "Ayer" },
    ...dias.filter((d) => d !== hoy && d !== ayer).slice(0, 5).map((d) => ({ fecha: d, label: d.slice(5).replace("-", "/") }))
  ];
  const unidadesActivas = dia.totales.unidades;
  const totalFlota = dia.flotaTotal && dia.flotaTotal >= unidadesActivas ? dia.flotaTotal : null;

  return (
    <section className="dia" aria-labelledby="dia-titulo">
      <div className="dia-barra">
        <div>
          <h2 id="dia-titulo">Resumen del día</h2>
          <p className="dia-fecha">{diaLindo(dia.fecha)}</p>
        </div>
        <div className="dia-acciones">
          <a className="ghost-button dia-descargar" href={`/admin/naves/en-vivo/planilla?fecha=${dia.fecha}`}>
            Descargar planilla (.xlsx)
          </a>
          <form className="dia-buscar" method="get" action="/admin/naves/en-vivo">
            <input type="hidden" name="vista" value="dia" />
            <label htmlFor="dia-fecha">Fecha</label>
            <input id="dia-fecha" type="date" name="fecha" defaultValue={dia.fecha} max={hoy} />
            <button type="submit" className="ghost-button">Ver</button>
          </form>
        </div>
      </div>

      <div className="dia-chips" role="group" aria-label="Días con actividad">
        {chips.map((chip) => (
          <Link
            key={chip.fecha}
            className="dia-chip"
            href={`/admin/naves/en-vivo?vista=dia&fecha=${chip.fecha}`}
            aria-current={chip.fecha === dia.fecha ? "true" : undefined}
          >
            {chip.label}
          </Link>
        ))}
      </div>

      {dia.truncado ? (
        <p className="dia-aviso">
          El día tiene más reportes de los que esta pantalla procesa de una vez: los totales son un piso. Se puede
          bajar el intervalo de reporte del chofer o pedir el resumen por unidad.
        </p>
      ) : null}

      <div className="dia-totales" role="group" aria-label="Totales del día">
        <div className="dia-total">
          <span className="dia-total-numero">{dia.totales.km.toLocaleString("es-AR")} km</span>
          <span className="dia-total-label">recorridos entre las {unidadesActivas} unidades</span>
        </div>
        <div className="dia-total">
          <span className="dia-total-numero">{minutosAHoras(dia.totales.minutosEnMovimiento)}</span>
          <span className="dia-total-label">horas-unidad en marcha</span>
        </div>
        <div className="dia-total">
          <span className="dia-total-numero">{minutosAHoras(dia.totales.minutosDetenido)}</span>
          <span className="dia-total-label">horas-unidad detenidas</span>
        </div>
        <div className="dia-total">
          <span className="dia-total-numero">
            {totalFlota ? `${unidadesActivas} / ${totalFlota}` : unidadesActivas}
          </span>
          <span className="dia-total-label">
            {totalFlota
              ? `unidades reportaron (${totalFlota - unidadesActivas} sin salir)`
              : unidadesActivas === 1
                ? "unidad con actividad"
                : "unidades con actividad"}
          </span>
        </div>
      </div>

      <section className="dia-seccion-tabla" aria-labelledby="dia-unidades-titulo">
        <h3 id="dia-unidades-titulo">Desglose por unidad y chofer</h3>
        {dia.jornadas.length === 0 ? (
          <p className="dia-vacio">No hay posiciones guardadas de ese día.</p>
        ) : (
          <div className="table-scroll">
            <table className="dia-tabla">
              <caption className="sr-only">Kilómetros, tiempos y paradas por unidad</caption>
              <thead>
                <tr>
                  <th scope="col">Unidad</th>
                  <th scope="col">Chofer</th>
                  <th scope="col" className="num">Km</th>
                  <th scope="col" className="num">Movimiento</th>
                  <th scope="col" className="num">Detenida</th>
                  <th scope="col" className="num">Máx.</th>
                  <th scope="col" className="num">Paradas</th>
                  <th scope="col">Señal</th>
                  <th scope="col" className="num">Acción</th>
                </tr>
              </thead>
              <tbody>
                {dia.jornadas.map((jornada) => (
                  <tr key={jornada.clave}>
                    <th scope="row">
                      <Link href={`/admin/naves/${jornada.vehicleId}`} className="dia-link-unidad">
                        {jornada.internalNumber ? `Interno ${jornada.internalNumber}` : jornada.vehicleName}
                      </Link>
                    </th>
                    <td>{jornada.driverName ?? "—"}</td>
                    <td className="num">{jornada.km.toLocaleString("es-AR")}</td>
                    <td className="num">{minutosAHoras(jornada.minutosEnMovimiento)}</td>
                    <td className="num">{minutosAHoras(jornada.minutosDetenido)}</td>
                    <td className="num">
                      {jornada.velocidadMaximaKmh == null ? "—" : `${jornada.velocidadMaximaKmh} km/h`}
                    </td>
                    <td className="num">
                      {jornada.paradas.length === 0 ? (
                        "—"
                      ) : (
                        <details className="dia-paradas-details">
                          <summary>{jornada.paradas.length}</summary>
                          <ul className="dia-paradas">
                            {jornada.paradas.map((parada) => (
                              <li key={`${parada.desde}-${parada.hasta}`}>
                                {hora(parada.desde)}–{hora(parada.hasta)} · {minutosAHoras(parada.minutos)}{" "}
                                <a
                                  href={`https://maps.google.com/?q=${parada.latitude},${parada.longitude}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="dia-link-mapa"
                                >
                                  (mapa)
                                </a>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="dia-senal">
                      {hora(jornada.primeraSenal)} → {hora(jornada.ultimaSenal)}
                      <span className="muted"> · {jornada.muestras.toLocaleString("es-AR")} reportes</span>
                    </td>
                    <td className="num">
                      <Link
                        className="dia-ver-vivo"
                        href={`/admin/naves/en-vivo?unidad=${encodeURIComponent(jornada.vehicleId)}`}
                      >
                        Ver en vivo
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dia-alertas" aria-labelledby="dia-alertas-titulo">
        <h3 id="dia-alertas-titulo">Novedades y excepciones ({dia.alertas.length})</h3>
        {dia.alertas.length === 0 ? (
          <p className="dia-sin-alertas">
            Nada para revisar: {dia.totales.unidades === 0 ? "no hubo reportes ese día." : "todas reportaron, sin excesos."}
          </p>
        ) : (
          <ul className="dia-alertas-lista">
            {dia.alertas.map((alerta, indice) => (
              <li key={`${alerta.driverId}-${alerta.tipo}-${indice}`} className={`dia-alerta ${SEVERIDAD[alerta.severidad]}`}>
                <span className="dia-alerta-punto" aria-hidden="true" />
                <span className="dia-alerta-nivel">{NIVEL[alerta.severidad]}</span>
                <span className="dia-alerta-texto">{alerta.texto}</span>
                <span className="dia-alerta-acciones">
                  {alerta.latitude != null && alerta.longitude != null ? (
                    <a
                      href={`https://maps.google.com/?q=${alerta.latitude},${alerta.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="dia-alerta-link"
                    >
                      Punto exacto
                    </a>
                  ) : null}
                  <Link
                    href={`/admin/naves/en-vivo?unidad=${encodeURIComponent(alerta.vehicleId)}`}
                    className="dia-alerta-link"
                  >
                    Ver en mapa
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="dia-nota">
        Una parada se cuenta desde {PARADA_MINIMA_MINUTOS} minutos. El exceso de velocidad se marca por encima de{" "}
        {LIMITE_VELOCIDAD_KMH} km/h: ese límite es una definición del cliente —si quiere otro, o distinto por unidad,
        se cambia acá—.
      </p>
    </section>
  );
}
