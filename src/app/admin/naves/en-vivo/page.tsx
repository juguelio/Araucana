import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { cargarFlotaEnVivo, VENTANA_SENAL_MINUTOS } from "@/lib/driver/en-vivo";
import { cargarRecorridos, VENTANA_RECORRIDO_HORAS } from "@/lib/driver/recorrido";
import { cargarDiaDeFlota, diasConActividad } from "@/lib/driver/dia";
import { fechaLocal, rangoDelDia } from "@/lib/driver/jornada";
import { cargarServiciosDelDia } from "@/lib/driver/servicios-consulta";
import { evaluarServiciosDelDia } from "@/lib/driver/servicios";
import { ServiciosDelDia } from "./servicios-del-dia";
import { AvisoDeServicios } from "./aviso-servicios";
import { AutoRefresco } from "./auto-refresco";
import { FlotaEnVivoMapa } from "./flota-en-vivo-mapa";
import { ResumenDelDia } from "./resumen-del-dia";
import "./en-vivo.css";

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

type Props = { searchParams?: Promise<{ vista?: string; fecha?: string; unidad?: string }> };

/**
 * Naves en vivo (issues #316, #321 y el adicional de seguimiento).
 *
 * Tres vistas del mismo dato: **en vivo** contesta «dónde está cada unidad ahora y qué servicio cubre»,
 * **resumen del día** contesta «qué hizo hoy» (lo que el dueño mira al cerrar la jornada y lo que se
 * factura) y **servicios de hoy** cruza el tablero con la señal real de cada unidad asignada.
 */
export default async function NavesEnVivoPage({ searchParams }: Props) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const query = (await searchParams) ?? {};
  const vista = query.vista === "dia" ? "dia" : query.vista === "servicios" ? "servicios" : "en-vivo";
  const hoy = fechaLocal(new Date());
  const fechaPedida = typeof query.fecha === "string" ? query.fecha : "";
  const fecha = rangoDelDia(fechaPedida) ? fechaPedida : hoy;
  const unidadSeleccionada = typeof query.unidad === "string" && query.unidad.trim() ? query.unidad.trim() : null;

  const [flota, recorridos, dia, dias, servicios] =
    vista === "en-vivo"
      ? [await cargarFlotaEnVivo(), await cargarRecorridos(), null, [] as string[], await cargarServiciosDelDia(fecha)]
      : vista === "dia"
        ? [null, [], await cargarDiaDeFlota(fecha), await diasConActividad(), null]
        : [await cargarFlotaEnVivo(), [], null, [] as string[], await cargarServiciosDelDia(fecha)];

  const resumenServicios = servicios ? evaluarServiciosDelDia(servicios, flota) : null;

  return (
    <AdminShell
      role={sessionUser.role}
      title="Naves en vivo"
      action={
        <Link className="ghost-button" href="/admin/naves">
          Volver a naves
        </Link>
      }
    >
      <div className="flota-barra-superior">
        <nav className="flota-tabs" aria-label="Vista">
          <Link href="/admin/naves/en-vivo" aria-current={vista === "en-vivo" ? "page" : undefined}>
            En vivo
          </Link>
          <Link
            href={`/admin/naves/en-vivo?vista=dia&fecha=${hoy}`}
            aria-current={vista === "dia" ? "page" : undefined}
          >
            Resumen del día
          </Link>
          <Link
            href={`/admin/naves/en-vivo?vista=servicios&fecha=${hoy}`}
            aria-current={vista === "servicios" ? "page" : undefined}
          >
            Servicios de hoy
            {resumenServicios && resumenServicios.enRiesgo > 0 ? (
              <span className="flota-tab-alerta">{resumenServicios.enRiesgo}</span>
            ) : null}
          </Link>
        </nav>

        {vista === "en-vivo" ? (
          <details className="flota-criterios">
            <summary>Criterios del mapa ({VENTANA_RECORRIDO_HORAS} h · lectura cada 30 s)</summary>
            <p>
              Muestra dónde está cada unidad y por dónde pasó en las últimas {VENTANA_RECORRIDO_HORAS} horas. Se lee
              cada 30 segundos; después de {VENTANA_SENAL_MINUTOS} minutos sin reportar queda{" "}
              <strong>sin señal</strong> en su última posición. La línea se corta si cambia la unidad o hay un hueco
              de más de 10 minutos.
            </p>
          </details>
        ) : null}
      </div>

      {vista === "en-vivo" && flota ? (
        <>
          <AutoRefresco cadaMs={60_000} />
          <AvisoDeServicios resumen={resumenServicios ?? evaluarServiciosDelDia([], flota)} fecha={fecha} />
          <FlotaEnVivoMapa
            inicial={flota}
            recorridosIniciales={recorridos ?? []}
            servicios={resumenServicios?.evaluados ?? []}
            unidadInicial={unidadSeleccionada}
          />
        </>
      ) : vista === "servicios" && resumenServicios ? (
        <>
          <AutoRefresco cadaMs={60_000} />
          <ServiciosDelDia resumen={resumenServicios} fecha={fecha} hoy={hoy} />
        </>
      ) : dia ? (
        <ResumenDelDia dia={dia} dias={dias} hoy={hoy} />
      ) : (
        <p className="dia-vacio">No se pudo leer ese día. Probá con otra fecha.</p>
      )}
    </AdminShell>
  );
}
