import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { getAdminExcursion } from "@/lib/excursions/repository";
import { excursionLocalDateTime, formatExcursionDate } from "@/lib/excursions/validation";
import { deleteExcursion, makeExcursionCover, removeExcursionPhoto, saveExcursion, uploadExcursionPhoto } from "../actions";
import { DeleteExcursionForm, ExcursionForm } from "../excursion-form";
import { ExcursionPhotoForm } from "../photo-form";
import { AdminSubmitButton } from "../../form-ui";
import styles from "../excursiones.module.css";

export default async function EditExcursionPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { id } = await params;
  const query = await searchParams;
  const excursion = await getAdminExcursion(id);
  if (!excursion) notFound();
  const now = new Date();
  const upcoming = excursion.departures.filter((departure) => departure.departureAt > now);
  const pastCount = excursion.departures.length - upcoming.length;

  return (
    <AdminShell title={excursion.name} role={user.role} notice={typeof query.notice === "string" ? query.notice : undefined}
      action={<Link className="ghost-button" href="/admin/excursiones">Volver al listado</Link>}>
      <div className={styles.stack}>
        <section className="plain-card admin-section">
          <div className={styles.cardActions}>
            <span className={styles.badge} data-published={excursion.isPublished}>{excursion.isPublished ? "Publicada" : "Borrador"}</span>
            {excursion.isPublished ? <Link className="table-link" href={`/excursiones/${excursion.id}`}>Ver en la web →</Link>
              : <span className={styles.help}>No visible en la web pública</span>}
          </div>
          <p>{upcoming[0] ? <>Próxima salida: <time dateTime={upcoming[0].departureAt.toISOString()}>{formatExcursionDate(upcoming[0].departureAt)}</time> · Hora argentina</> : "Sin próximas fechas"}</p>
          <p className={styles.help}>{upcoming.length} {upcoming.length === 1 ? "salida próxima" : "salidas próximas"}{pastCount > 0 ? ` · ${pastCount} ${pastCount === 1 ? "salida pasada conservada" : "salidas pasadas conservadas"}` : ""}</p>
          <h2>Datos y fechas de salida</h2>
          <ExcursionForm key={excursion.updatedAt.toISOString()}
            action={saveExcursion.bind(null, excursion.id, excursion.updatedAt.toISOString())}
            photoCount={excursion.photos.length}
            excursion={{
              name: excursion.name,
              description: excursion.description,
              duration: excursion.duration,
              priceCents: excursion.priceCents,
              currency: excursion.currency,
              isPublished: excursion.isPublished,
              departures: excursion.departures.map((departure) => excursionLocalDateTime(departure.departureAt))
            }} />
        </section>

        <section className="plain-card admin-section" id="fotos">
          <h2>Fotos: portada y galería</h2>
          <p className={styles.help}>La portada aparece primero. Podés elegir otra foto como portada o quitar fotos de la galería. Si quitás la última foto, la excursión vuelve a borrador. Guardá los cambios del formulario antes de gestionar fotos.</p>
          {excursion.photos.length === 0 ? <p>Todavía no hay fotos. Cargá al menos una para habilitar la publicación.</p> : (
            <ul className={styles.photoGrid}>
              {excursion.photos.map((photo, index) => (
                <li key={photo.id} className={styles.photoCard}>
                  <Image src={`/excursiones/fotos/${photo.id}`} alt={`${excursion.name} · ${index === 0 ? "portada" : `foto ${index + 1}`}`}
                    width={600} height={400} unoptimized />
                  <div className={styles.photoBody}>
                    <p><strong>{index === 0 ? "Portada" : `Foto de galería ${index}`}</strong></p>
                    <div className={styles.cardActions}>
                      {index !== 0 && <form action={makeExcursionCover.bind(null, excursion.id, photo.id)}>
                        <AdminSubmitButton>Usar como portada</AdminSubmitButton>
                      </form>}
                      <form action={removeExcursionPhoto.bind(null, excursion.id, photo.id)}>
                        <AdminSubmitButton>Quitar foto</AdminSubmitButton>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ExcursionPhotoForm action={uploadExcursionPhoto.bind(null, excursion.id)} />
        </section>

        <section className="plain-card admin-section">
          <DeleteExcursionForm action={deleteExcursion.bind(null, excursion.id)} name={excursion.name} />
        </section>
      </div>
    </AdminShell>
  );
}
