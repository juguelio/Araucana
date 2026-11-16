import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { updateVehicleAction } from "../actions";
import { VehicleForm } from "../vehicle-form";

type EditVehiclePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditVehiclePage({ params }: EditVehiclePageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: {
      seats: {
        orderBy: [{ row: "asc" }, { column: "asc" }, { number: "asc" }]
      }
    }
  });

  if (!vehicle) {
    notFound();
  }

  return (
    <AdminShell role={sessionUser.role} title="Editar nave">
      <section className="plain-card admin-section">
        <h2>{vehicle.name}</h2>
        <VehicleForm action={updateVehicleAction} vehicle={vehicle} submitLabel="Guardar cambios" />
      </section>
    </AdminShell>
  );
}
