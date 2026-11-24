import { ChoferBuscador, type ChoferElegible } from "@/app/admin/aeropuerto/chofer-buscador";
import { NaveBuscador, type NaveElegible } from "@/app/admin/aeropuerto/nave-buscador";
import { RowModal } from "@/app/admin/reservas/row-modal";
import "./asignar-unidad.css";
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

export type ChoferParaAsignar = ChoferElegible;

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
  returnTo = ""
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
}) {
  return (
    <RowModal
      trigger={trigger}
      triggerLabel={`${trigger}: ${titulo}`}
      triggerClassName={triggerClassName}
      modalClassName="asignar-unidad-modal"
      eyebrow={eyebrow ?? (defaultVehicleId ? "Cambiar nave y chofer" : "Asignar nave y chofer")}
      title={titulo}
      subtitle={subtitulo}
    >
      <form className="reservas-modal-form" action={asignarUnidadAction}>
        <input type="hidden" name="servicioId" value={servicioId} />
        <input type="hidden" name="fecha" value={fecha} />
        <input type="hidden" name="vista" value={vista} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        {assignmentId ? <input type="hidden" name="assignmentId" value={assignmentId} /> : null}
        {page > 1 ? <input type="hidden" name="page" value={page} /> : null}

        <div className="asignar-unidad-columnas">
          <NaveBuscador naves={naves} flightNumber={titulo} defaultId={defaultVehicleId} seatsLabel="lugares" />
          <ChoferBuscador choferes={choferes} flightNumber={titulo} defaultId={defaultDriverId} />
        </div>

        <button className="button" type="submit">
          Asignar nave
        </button>
      </form>
    </RowModal>
  );
}
