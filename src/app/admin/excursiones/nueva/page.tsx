import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { saveExcursion } from "../actions";
import { ExcursionForm } from "../excursion-form";
import styles from "../excursiones.module.css";

export default async function NewExcursionPage() {
  const user = await getCurrentReservationsUserOrRedirect();

  return (
    <AdminShell title="Nueva excursión" role={user.role}>
      <section className="plain-card admin-section">
        <h2>Crear un borrador</h2>
        <p className={styles.help}>Las fotos se cargan después de crear el borrador. Para publicar se necesita al menos una foto.</p>
        <ExcursionForm action={saveExcursion.bind(null, null, null)} />
      </section>
    </AdminShell>
  );
}
