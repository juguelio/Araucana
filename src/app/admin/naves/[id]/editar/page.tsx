import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { deleteVehicleAction, setVehicleActiveAction, updateVehicleAction } from "../../actions";
import { ConfirmVehicleButton } from "../confirm-vehicle-button";
import { CabeceraDeNave, cargarNave } from "../ficha-de-nave";
import { VehicleForm } from "../../vehicle-form";

type EditVehiclePageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{ notice?: string }>;
};

export default async function EditVehiclePage({ params, searchParams }: EditVehiclePageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: {
      seats: {
        orderBy: [{ row: "asc" }, { column: "asc" }, { number: "asc" }]
      },
      _count: { select: { schedules: true, scheduleUnits: true, specialTripAssignments: true, damages: true } }
    }
  });

  if (!vehicle) {
    notFound();
  }
  const notice = (await searchParams)?.notice;
  // Con salidas o viajes asignados no se borra: se archiva (queda inactiva) para no romper el historial.
  const conHistorial =
    vehicle._count.schedules + vehicle._count.scheduleUnits + vehicle._count.specialTripAssignments + vehicle._count.damages > 0;
  const nave = await cargarNave(id);

  return (
    <AdminShell role={sessionUser.role} title="Editar nave" notice={notice}>
      <CabeceraDeNave nave={nave} seccion="editar" />
      <section className="plain-card admin-section">
        <h2>Datos de la unidad</h2>
        <VehicleForm action={updateVehicleAction} vehicle={vehicle} submitLabel="Guardar cambios" />
      </section>

      <section className="plain-card admin-section" aria-labelledby="nave-estado">
        <h2 id="nave-estado">Estado de la nave</h2>
        <p className="muted">
          {vehicle.isActive
            ? "Activa: se puede asignar a salidas, viajes y traslados."
            : "No habilitada: no se ofrece para asignar. Sus datos y su historial se conservan."}
        </p>
        <div className="table-actions">
          <form action={setVehicleActiveAction}>
            <input type="hidden" name="id" value={vehicle.id} />
            <input type="hidden" name="isActive" value={vehicle.isActive ? "false" : "true"} />
            <ConfirmVehicleButton
              className="ghost-button"
              label={vehicle.isActive ? "Inactivar nave" : "Activar nave"}
              pregunta={vehicle.isActive ? `¿Inactivar ${vehicle.name}? No se va a poder asignar a nuevas salidas.` : `¿Activar ${vehicle.name}?`}
            />
          </form>
          <form action={deleteVehicleAction}>
            <input type="hidden" name="id" value={vehicle.id} />
            <ConfirmVehicleButton
              className="danger-button"
              label={conHistorial ? "Archivar nave" : "Borrar nave"}
              pregunta={
                conHistorial
                  ? `${vehicle.name} ya tiene salidas o viajes: se archiva y queda inactiva. ¿Continuar?`
                  : `¿Borrar ${vehicle.name}? No se puede deshacer.`
              }
            />
          </form>
        </div>
        {conHistorial ? (
          <p className="muted">Tiene salidas, viajes o daños registrados: no se borra, se archiva para conservar el historial.</p>
        ) : null}
      </section>
    </AdminShell>
  );
}
