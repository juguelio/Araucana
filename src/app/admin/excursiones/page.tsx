import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { listAdminExcursions } from "@/lib/excursions/repository";
import { formatExcursionDate } from "@/lib/excursions/validation";
import styles from "./excursiones.module.css";

export default async function AdminExcursionsPage({ searchParams }: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const excursions = await listAdminExcursions();
  const now = new Date();

  return (
    <AdminShell title="Excursiones" role={user.role} notice={typeof params.notice === "string" ? params.notice : undefined}
      action={<div className="form-actions">
        <Link className="button" href="/admin/excursiones/nueva">Nueva excursión</Link>
        <Link className="ghost-button" href="/admin/excursiones/ventas/nueva">Registrar venta</Link>
        <Link className="ghost-button" href="/admin/excursiones/planilla">Planilla del día</Link>
      </div>}>
      <section className="plain-card admin-section">
        <h2>Catálogo de excursiones</h2>
        <p className={styles.help}>Creá un borrador, agregá sus fotos y publicalo cuando esté listo. Las fechas son opcionales.</p>
        <p><Link href="/excursiones" className="table-link">Ver catálogo público →</Link></p>
        {excursions.length === 0 ? <p>Todavía no hay excursiones. Creá la primera para comenzar.</p> : (
          <ul className={styles.cardList}>
            {excursions.map((excursion) => {
              const upcoming = excursion.departures.filter((departure) => departure.departureAt > now);
              return (
                <li key={excursion.id} className={styles.excursionCard}>
                  <div>
                    <span className={styles.badge} data-published={excursion.isPublished}>{excursion.isPublished ? "Publicada" : "Borrador"}</span>
                    <h3><Link href={`/admin/excursiones/${excursion.id}`}>{excursion.name}</Link></h3>
                    <div className={styles.meta}>
                      <span>{excursion.duration}</span>
                      <span>{excursion.priceCents == null ? "Precio a consultar" : `${excursion.currency} ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(excursion.priceCents / 100)}`}</span>
                      <span>{excursion.photos.length} {excursion.photos.length === 1 ? "foto" : "fotos"}</span>
                    </div>
                    <p>{upcoming[0] ? <>Próxima salida: <time dateTime={upcoming[0].departureAt.toISOString()}>{formatExcursionDate(upcoming[0].departureAt)}</time></> : "Sin próximas fechas"}</p>
                    {upcoming.length > 0 && <p className={styles.help}>{upcoming.length} {upcoming.length === 1 ? "fecha próxima" : "fechas próximas"} · Hora argentina</p>}
                  </div>
                  <div className={styles.cardActions}>
                    <Link className="ghost-button" href={`/admin/excursiones/${excursion.id}`}>Gestionar</Link>
                    {excursion.isPublished && <Link className="table-link" href={`/excursiones/${excursion.id}`}>Ver en la web →</Link>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
