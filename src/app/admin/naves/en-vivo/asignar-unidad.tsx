import { SelectorNaveYChofer, type ChoferOpcion } from "@/components/asignar-flota/selector-nave-chofer";
import { tituloDeNave } from "@/lib/fleet/titulo-de-nave";
import { RowModal } from "@/app/admin/reservas/row-modal";
import type { EstadoDeOpcion } from "@/lib/fleet/ocupacion";
import { prisma } from "@/lib/db/prisma";
import { asignarUnidadAction } from "./actions";

/**
 * «Asignar nave» desde el aviso rojo y desde Servicios de hoy: el mismo gesto que el modal de combis
 * del aeropuerto —elegir unidad y chofer sin cambiar de pantalla— pero sirviendo a las dos áreas que
 * comparten flota (ruta y aeropuerto).
 */

export type NaveParaAsignar = {
  id: string;
  name: string;
  internalNumber: string | null;
  licensePlate: string | null;
  seats: number;
};

export type ChoferParaAsignar = ChoferOpcion;

/** Naves de pasajeros activas (sin utilitarios) y choferes activos, igual que el modal del aeropuerto. */
export async function opcionesParaAsignar(): Promise<{ naves: NaveParaAsignar[]; choferes: ChoferParaAsignar[] }> {
  const [naves, choferes] = await Promise.all([
    prisma.vehicle.findMany({
      where: { isActive: true, kind: { not: "UTILITARIO" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, internalNumber: true, licensePlate: true, _count: { select: { seats: true } } }
    }),
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true }
    })
  ]);

  return {
    naves: naves.map((nave) => ({
      id: nave.id,
      name: nave.name,
      internalNumber: nave.internalNumber,
      licensePlate: nave.licensePlate,
      seats: nave._count.seats
    })),
    choferes: choferes.map((chofer) => ({ id: chofer.id, label: chofer.name?.trim() || chofer.email, email: chofer.email }))
  };
}

export function AsignarUnidad({
  servicioId,
  titulo,
  subtitulo,
  fecha,
  naves,
  choferes,
  triggerClassName = "srv-asignar",
  eyebrow,
  trigger = "Asignar nave",
  vista = "en-vivo",
  defaultVehicleId = "",
  defaultDriverId = "",
  assignmentId = "",
  page = 1,
  returnTo = "",
  ocupacionNaves,
  ocupacionChoferes,
  lugaresQueFaltan = null
}: {
  servicioId: string;
  titulo: string;
  subtitulo?: string;
  fecha: string;
  naves: NaveParaAsignar[];
  choferes: ChoferParaAsignar[];
  triggerClassName?: string;
  eyebrow?: string;
  trigger?: string;
  vista?: "en-vivo" | "servicios";
  defaultVehicleId?: string;
  defaultDriverId?: string;
  assignmentId?: string;
  page?: number;
  returnTo?: string;
  /** Qué naves y choferes están en otro servicio a esa hora (`ocupacionEnVentana`). */
  ocupacionNaves?: Record<string, EstadoDeOpcion>;
  ocupacionChoferes?: Record<string, EstadoDeOpcion>;
  /** Pasajeros del servicio: una nave con menos lugares se marca «no alcanza». */
  lugaresQueFaltan?: number | null;
}) {
  const naveActual = naves.find((nave) => nave.id === defaultVehicleId);
  const choferActual = choferes.find((chofer) => chofer.id === defaultDriverId);
  return (
    <RowModal
      trigger={trigger}
      triggerLabel={`${trigger}: ${titulo}`}
      triggerClassName={triggerClassName}
      modalClassName="asignar-flota-modal"
      eyebrow={eyebrow ?? (defaultVehicleId ? "Cambiar nave y chofer" : "Asignar nave y chofer")}
      title={titulo}
      subtitle={subtitulo}
    >
      {defaultVehicleId ? (
        <p className="asignar-flota-ahora">
          <span>Ahora: <strong>{naveActual ? tituloDeNave(naveActual) : "otra nave"}</strong></span>
          <span>Chofer: <strong>{choferActual ? choferActual.label : "sin chofer"}</strong></span>
        </p>
      ) : null}
      <form className="asignar-flota-form" action={asignarUnidadAction}>
        <input type="hidden" name="servicioId" value={servicioId} />
        <input type="hidden" name="fecha" value={fecha} />
        <input type="hidden" name="vista" value={vista} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        {assignmentId ? <input type="hidden" name="assignmentId" value={assignmentId} /> : null}
        {page > 1 ? <input type="hidden" name="page" value={page} /> : null}

        <SelectorNaveYChofer
          servicio={`${eyebrow ?? ""} ${titulo}`.trim()}
          naves={naves}
          choferes={choferes}
          ocupacionNaves={ocupacionNaves}
          ocupacionChoferes={ocupacionChoferes}
          naveActual={defaultVehicleId}
          choferActual={defaultDriverId}
          lugaresQueFaltan={lugaresQueFaltan}
          boton={defaultVehicleId ? "Guardar cambios" : "Asignar"}
        />
      </form>
    </RowModal>
  );
}
