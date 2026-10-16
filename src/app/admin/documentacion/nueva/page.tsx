import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { createDocumentAction } from "../actions";
import { DocumentForm } from "../document-form";

export default async function NewDocumentPage() {
  await getCurrentAdminOrRedirect();

  const [vehicles, drivers] = await Promise.all([
    prisma.vehicle.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, licensePlate: true } }),
    prisma.user.findMany({
      where: { role: "DRIVER" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true }
    })
  ]);

  return (
    <AdminShell title="Agregar documento" eyebrow="Documentación">
      <section className="plain-card admin-section">
        <h2>Documento de nave o chofer</h2>
        <p className="muted">
          Si el documento es crítico y está vencido, el sistema bloquea la salida de esa nave o la asignación
          de ese chofer.
        </p>
        <DocumentForm action={createDocumentAction} vehicles={vehicles} drivers={drivers} />
      </section>
    </AdminShell>
  );
}
