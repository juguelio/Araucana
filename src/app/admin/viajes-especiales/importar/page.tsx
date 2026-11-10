import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { ImportForm } from "./import-form";

export default async function ImportPage() {
  const user = await getCurrentReservationsUserOrRedirect();
  const archived = await prisma.specialTripSource.findMany({ where: { tripId: null }, orderBy: [{ sheet: "asc" }, { row: "asc" }] });
  return <AdminShell title="Importar historial" role={user.role}
    action={<Link href="/admin/viajes-especiales" className="ghost-button">Volver a Viajes especiales</Link>}>
    <ImportForm />
    {!!archived.length && <section className="plain-card admin-section">
      <h2>Filas archivadas para revisión</h2>
      {archived.map((source) => <details key={source.id}>
        <summary>{source.sheet} · fila {source.row}</summary>
        {Array.isArray(source.issues) && source.issues.map((issue, i) => <p key={i}>{String(issue)}</p>)}
        {Array.isArray(source.original) && <p>{source.original.map((cell) => String(cell ?? "")).join(" · ")}</p>}
      </details>)}
    </section>}
  </AdminShell>;
}
