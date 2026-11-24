import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { importarPlanilla } from "./actions";
import "../escolares.css";

export default async function ImportarPlanillaPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  return (
    <AdminShell title="Concesiones" eyebrow="Importar planilla" role={user.role} notice={params.aviso}
      action={<Link className="ghost-button" href="/admin/escolares/semana">Volver a la semana</Link>}>
      <section className="plain-card admin-section">
        <h2>Importar «Trabajo semanal»</h2>
        <p className="muted">
          Subí el Excel original. Se importan sólo los servicios de Concesiones: escuelas, personal de aeropuerto
          y otros recorridos recurrentes. No se importan vuelos, francos, feriados ni licencias; esos siguen en
          sus módulos.
        </p>
        <p className="muted">
          Si el chofer de la planilla coincide con un usuario activo, queda asignado. Si no, el servicio se
          importa sin chofer y con el nombre original en «Pendiente de revisión» para asignarlo después.
        </p>
        <form action={importarPlanilla} encType="multipart/form-data" className="admin-form-grid">
          <label className="span-2">Archivo .xlsx<input type="file" name="archivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label>
          <div className="inline-actions span-2"><button className="button">Importar planilla</button><Link className="ghost-button" href="/admin/escolares/semana">Cancelar</Link></div>
        </form>
      </section>
      <section className="plain-card admin-section">
        <h3>Qué toma de cada hoja</h3>
        <p className="muted">Las hojas diarias (011126, 021126, …) y no las hojas «x ch» de avisos. De cada fila usa fecha, recorrido, horario, chofer 1, chofer 2 y el estado de la planilla.</p>
      </section>
    </AdminShell>
  );
}
