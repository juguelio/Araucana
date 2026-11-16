import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { createVehicleAction } from "../actions";
import { VehicleForm } from "../vehicle-form";

export default async function NewVehiclePage() {
  const sessionUser = await getCurrentAdminOrRedirect();

  return (
    <AdminShell role={sessionUser.role} title="Agregar nave">
      <section className="plain-card admin-section">
        <h2>Nueva nave</h2>
        <VehicleForm action={createVehicleAction} submitLabel="Crear nave" />
      </section>
    </AdminShell>
  );
}
