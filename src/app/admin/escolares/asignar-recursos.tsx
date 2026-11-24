"use client";

import { RowModal } from "@/app/admin/reservas/row-modal";
import { SelectorNaveYChofer, type ChoferOpcion, type NaveOpcion } from "@/components/asignar-flota/selector-nave-chofer";
import { assignSchoolRunResources } from "./actions";

/**
 * «Asignar» desde la tabla de Concesiones: el mismo selector de nave y chofer que usan Aeropuerto,
 * Naves en vivo y Servicio público, sin salir del día. El servidor vuelve a validar unidad y chofer
 * activos y deja auditoría; acá sólo se arma el formulario.
 */
export function AsignarRecursosConcesion({
  id,
  titulo,
  subtitulo,
  fecha,
  revision,
  returnTo,
  naves,
  choferes,
  naveActual,
  choferActual,
  trigger,
  triggerClassName = "pill school-assign-trigger"
}: {
  id: string;
  titulo: string;
  subtitulo: string;
  fecha: string;
  revision: number;
  returnTo: string;
  naves: NaveOpcion[];
  choferes: ChoferOpcion[];
  naveActual: string;
  choferActual: string;
  trigger: string;
  triggerClassName?: string;
}) {
  return (
    <RowModal
      trigger={trigger}
      triggerLabel={`Asignar nave y chofer: ${titulo}`}
      triggerClassName={triggerClassName}
      modalClassName="asignar-flota-modal"
      eyebrow={naveActual ? "Cambiar nave y chofer" : "Asignar nave y chofer"}
      title={titulo}
      subtitle={`${fecha} · ${subtitulo}`}
    >
      {naveActual ? (
        <p className="asignar-flota-ahora">
          <span>Ahora: <strong>{naves.find((nave) => nave.id === naveActual)?.name ?? "otra nave"}</strong></span>
          <span>Chofer: <strong>{choferes.find((chofer) => chofer.id === choferActual)?.label ?? "sin chofer"}</strong></span>
        </p>
      ) : null}
      <form className="asignar-flota-form" action={assignSchoolRunResources}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="fecha" value={fecha} />
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <SelectorNaveYChofer
          servicio={`${titulo} ${fecha}`}
          naves={naves}
          choferes={choferes}
          naveActual={naveActual}
          choferActual={choferActual}
          boton={naveActual ? "Guardar cambios" : "Asignar"}
        />
      </form>
    </RowModal>
  );
}
