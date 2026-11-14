import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { listAdminExcursions } from "@/lib/excursions/repository";
import { VentaDeExcursionForm } from "./venta-form";

export const dynamic = "force-dynamic";

/** Alta manual de una venta de excursión (#110): el equipo carga las derivaciones a mano. */
export default async function NuevaVentaDeExcursionPage({
  searchParams
}: {
  searchParams: Promise<{ excursion?: string; date?: string }>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const excursions = await listAdminExcursions();

  const opciones = excursions.map((excursion) => ({
    id: excursion.id,
    name: excursion.name,
    priceCents: excursion.priceCents
  }));

  return (
    <AdminShell
      title="Registrar venta de excursión"
      eyebrow="Operación"
      role={user.role}
      action={<Link className="ghost-button" href="/admin/excursiones">Volver a excursiones</Link>}
    >
      {opciones.length === 0 ? (
        <section className="plain-card admin-section">
          <p>Todavía no hay excursiones cargadas. Creá una en <Link href="/admin/excursiones/nueva">Nueva excursión</Link>.</p>
        </section>
      ) : (
        <VentaDeExcursionForm excursiones={opciones} porDefecto={{ excursionId: params?.excursion, date: params?.date }} />
      )}
    </AdminShell>
  );
}
