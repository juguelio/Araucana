import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { cargarFlotaEnVivo, VENTANA_SENAL_MINUTOS } from "@/lib/driver/en-vivo";
import { cargarPlanesDelDia } from "@/lib/driver/planes-del-dia";
import { cargarRecorridosDeHoy } from "@/lib/driver/recorrido";
import { cargarDiaDeFlota, diasConActividad } from "@/lib/driver/dia";
import { fechaLocal, rangoDelDia } from "@/lib/driver/jornada";
import { prisma } from "@/lib/db/prisma";
import { nombreDeUnidad } from "@/lib/vehicles/enlace-mapa";
import { cargarServiciosDelDia } from "@/lib/driver/servicios-consulta";
import { evaluarServiciosDelDia } from "@/lib/driver/servicios";
import { ServiciosDelDia } from "./servicios-del-dia";
import { opcionesParaAsignar } from "./asignar-unidad";
import { AvisoDeServicios } from "./aviso-servicios";
import { AutoRefresco } from "./auto-refresco";
import { FlotaEnVivoMapa } from "./flota-en-vivo-mapa";
import { ResumenDelDia } from "./resumen-del-dia";
import "./en-vivo.css";

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

type Props = {
  searchParams?: Promise<{ vista?: string; fecha?: string; unidad?: string; ok?: string; error?: string; page?: string }>;
};

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
  const ahora = new Date();
  const hoy = fechaLocal(ahora);
  const fechaPedida = typeof query.fecha === "string" ? query.fecha : "";
  const fecha = vista !== "en-vivo" && rangoDelDia(fechaPedida) ? fechaPedida : hoy;
  const unidadSeleccionada = typeof query.unidad === "string" && query.unidad.trim() ? query.unidad.trim() : null;
  const paginaServicios = Math.max(1, Number.parseInt(String(query.page ?? ""), 10) || 1);
  /** Resultado de asignar nave desde el aviso o desde la lista (server action → redirect). */
  const aviso = query.ok ? { tono: "ok" as const, texto: query.ok } : query.error ? { tono: "error" as const, texto: query.error } : null;

  /**
   * La unidad pedida puede no tener posición (el chofer nunca abrió el panel). Se resuelve el nombre
   * igual, para decirlo con la unidad en la mano en lugar de dejar la pantalla como si nada hubiera
   * pasado cuando alguien llega desde el tablero de flota.
   */
  const unidadPedida = unidadSeleccionada
    ? await prisma.vehicle
        .findFirst({
          where: { OR: [{ id: unidadSeleccionada }, { internalNumber: unidadSeleccionada }] },
          select: { id: true, name: true, internalNumber: true }
        })
        .then((nave) => (nave ? { id: nave.id, nombre: nombreDeUnidad(nave) } : null))
        .catch(() => null)
    : null;

  const [flota, recorridos, dia, dias, servicios] =
    vista === "en-vivo"
      ? await Promise.all([cargarFlotaEnVivo(ahora), cargarRecorridosDeHoy(ahora), null, [] as string[], cargarServiciosDelDia(hoy)] as const)
      : vista === "dia"
        ? [null, null, await cargarDiaDeFlota(fecha), await diasConActividad(), null]
        : [await cargarFlotaEnVivo(), null, null, [] as string[], await cargarServiciosDelDia(fecha)];

  const planes = vista === "en-vivo" && servicios ? await cargarPlanesDelDia(hoy, servicios) : [];
  const resumenServicios = servicios ? evaluarServiciosDelDia(servicios, flota) : null;

  // Naves y choferes para el modal «Asignar nave»: en Servicios del día se puede asignar
  // cualquier servicio que no haya terminado, aunque todavía no esté en riesgo.
  const necesitaAsignar = Boolean(
    resumenServicios &&
      (resumenServicios.enRiesgo > 0 ||
        (vista === "servicios" && resumenServicios.evaluados.some((servicio) => servicio.nivel !== "pasado")))
  );
  const opciones = necesitaAsignar ? await opcionesParaAsignar() : { naves: [], choferes: [] };

  return (
    <AdminShell
      role={sessionUser.role}
      title="Naves en vivo"
      action={
        <Link className="ghost-button" href="/admin/naves">
          Tablero de flota
        </Link>
      }
    >
      {aviso ? (
        <p className={`en-vivo-aviso ${aviso.tono === "ok" ? "es-ok" : "es-error"}`} role="status">
          {aviso.texto}
        </p>
      ) : null}
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
            <summary>Cómo leer el mapa de hoy</summary>
            <p>
              Las líneas punteadas muestran la ruta prevista y las continuas, el GPS desde la medianoche argentina.
              Pasá el mouse o tocá un recorrido para ver la salida y su nave. La posición se actualiza cada 30 segundos. Después de {VENTANA_SENAL_MINUTOS} minutos sin reportar queda{" "}
              <strong>sin señal</strong> en su última posición. El aviso de posible desvío aparece durante la salida cuando el GPS se aleja más de 500 m
              de la carretera de referencia, más el margen de precisión del teléfono. Entre paradas el margen es mayor.
            </p>
          </details>
        ) : null}
      </div>

      {vista === "en-vivo" && flota ? (
        <>
          <AutoRefresco cadaMs={60_000} />
          <AvisoDeServicios resumen={resumenServicios ?? evaluarServiciosDelDia([], flota)} fecha={fecha} naves={opciones.naves} choferes={opciones.choferes} />
          <FlotaEnVivoMapa
            inicial={flota}
            key={hoy}
            fecha={hoy}
            planes={planes}
            truncadoInicial={recorridos?.truncado ?? false}
            recorridosIniciales={recorridos?.recorridos ?? []}
            servicios={resumenServicios?.evaluados ?? []}
            unidadInicial={unidadSeleccionada}
            unidadPedida={unidadPedida}
          />
        </>
      ) : vista === "servicios" && resumenServicios ? (
        <>
          <AutoRefresco cadaMs={60_000} />
          <ServiciosDelDia resumen={resumenServicios} fecha={fecha} hoy={hoy} page={paginaServicios} naves={opciones.naves} choferes={opciones.choferes} />
        </>
      ) : dia ? (
        <ResumenDelDia dia={dia} dias={dias} hoy={hoy} />
      ) : (
        <p className="dia-vacio">No se pudo leer ese día. Probá con otra fecha.</p>
      )}
    </AdminShell>
  );
}
