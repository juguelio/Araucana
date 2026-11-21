import Link from "next/link";
import type { ResumenDeServicios } from "@/lib/driver/servicios";

/**
 * Aviso arriba del mapa: mientras alguien mira las unidades, esto le dice si algún servicio del día
 * se está quedando sin cobertura, qué nave lo tiene asignado y permite centrarla en el mapa o ir a
 * asignarla en un clic.
 */
export function AvisoDeServicios({ resumen, fecha }: { resumen: ResumenDeServicios; fecha: string }) {
  const pendientes = resumen.evaluados.filter(
    (servicio) => servicio.nivel === "sin-unidad" || servicio.nivel === "en-riesgo"
  );
  if (pendientes.length === 0) return null;

  const primeros = pendientes.slice(0, 2);
  const resto = pendientes.length - primeros.length;

  return (
    <aside className="aviso-servicios" role="status">
      <div className="aviso-servicios-cabecera">
        <strong className="aviso-servicios-titulo">
          {pendientes.length} {pendientes.length === 1 ? "servicio pide" : "servicios piden"} atención
        </strong>
        {resto > 0 ? <span className="aviso-servicios-resto">+{resto} más</span> : null}
      </div>

      <ul className="aviso-servicios-lista">
        {primeros.map((servicio) => {
          const primeraUnidad = servicio.unidades[0] ?? null;
          const etiquetaUnidad = primeraUnidad
            ? `${primeraUnidad.internalNumber ?? primeraUnidad.vehicleName}${primeraUnidad.driverName ? ` (${primeraUnidad.driverName})` : ""}`
            : null;
          return (
            <li key={servicio.id}>
              <span className="aviso-servicios-texto">
                <b>
                  {servicio.at
                    ? servicio.at.toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                        timeZone: "America/Argentina/Buenos_Aires"
                      })
                    : "sin hora"}
                </b>
                {` · ${servicio.titulo}`}
                {etiquetaUnidad ? ` · ${etiquetaUnidad}` : ""} — {servicio.motivo}
              </span>
              {primeraUnidad ? (
                <Link
                  className="aviso-servicios-accion"
                  href={`/admin/naves/en-vivo?unidad=${encodeURIComponent(primeraUnidad.vehicleId)}`}
                >
                  Ver en mapa
                </Link>
              ) : (
                <Link className="aviso-servicios-accion" href={servicio.href}>
                  Asignar nave
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <Link className="aviso-servicios-link" href={`/admin/naves/en-vivo?vista=servicios&fecha=${fecha}`}>
        Ver los {pendientes.length}
      </Link>
    </aside>
  );
}
