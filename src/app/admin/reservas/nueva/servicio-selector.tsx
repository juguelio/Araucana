import Link from "next/link";
import type { ServicioDeRuta } from "./viaje-utils";

/**
 * «¿Qué reservás?»: el selector de servicio de la pantalla única de «Reservar» (pedido de Jugue,
 * 19-nov: «al clickear reservar, que la primera opción sea aeropuerto… luego Traful… que todo se
 * pueda hacer desde la misma pantalla»). Son links (`?servicio=`): el servicio queda en la dirección,
 * se puede compartir y el «atrás» del navegador vuelve al anterior.
 */
export function ServicioSelector({ actual, servicios }: { actual: string; servicios: ServicioDeRuta[] }) {
  return (
    <nav className="servicio-selector" aria-label="¿Qué reservás?">
      <p className="servicio-selector-titulo">¿Qué reservás?</p>
      <ul>
        <li>
          <Link
            href="/admin/reservas/nueva?servicio=aeropuerto"
            scroll={false}
            className="servicio-opcion"
            aria-current={actual === "aeropuerto" ? "page" : undefined}
          >
            <span className="servicio-icono" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M10.5 21 12 18l1.5 3M12 18V13M3 13l9-2 9 2M12 11V5a1.5 1.5 0 0 0-3 0v6" /></svg>
            </span>
            <span className="servicio-texto">
              <b>Aeropuerto Chapelco</b>
              <small>Llegadas y salidas por vuelo</small>
            </span>
          </Link>
        </li>
        {servicios.map((servicio) => (
          <li key={servicio.clave}>
            <Link
              href={`/admin/reservas/nueva?servicio=${encodeURIComponent(servicio.clave)}`}
              scroll={false}
              className="servicio-opcion"
              aria-current={actual === servicio.clave ? "page" : undefined}
            >
              <span className="servicio-icono" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
              </span>
              <span className="servicio-texto">
                <b>{servicio.titulo}</b>
                <small>{servicio.detalle} · {servicio.salidas ? `${servicio.salidas} ${servicio.salidas === 1 ? "salida" : "salidas"}` : "sin salidas cargadas"}</small>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
