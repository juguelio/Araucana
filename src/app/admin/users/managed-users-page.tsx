import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getManagedUserRoleName, getManagedUserPath, type ManagedUserRole } from "@/lib/admin/users";
import { formatCurrency } from "@/lib/admin/salary";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { deleteManagedUserAction, setManagedUserActiveAction } from "./actions";

type ManagedUsersPageProps = { role?: ManagedUserRole; notice?: string; query?: string };

export async function ManagedUsersPage({ role, notice, query = "" }: ManagedUsersPageProps) {
  await getCurrentAdminOrRedirect();
  const search = query.trim();
  const users = await prisma.user.findMany({
    where: {
      ...(role ? { role } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] } : {})
    },
    orderBy: [{ isActive: "asc" }, { createdAt: "desc" }],
    select: { id: true, email: true, name: true, role: true, isActive: true, monthlySalaryCents: true, salaryCurrency: true, createdAt: true }
  });
  const pendingCount = users.filter((user) => !user.isActive && user.role === "USER").length;
  const activeCount = users.filter((user) => user.isActive).length;

  return (
    <AdminShell title={role ? getManagedUserRoleName(role) : "Usuarios"} notice={notice}>
      <section className="admin-grid">
        <div className="admin-card"><span className="muted">Pendientes</span><strong>{pendingCount}</strong></div>
        <div className="admin-card"><span className="muted">Activos</span><strong>{activeCount}</strong></div>
        <div className="admin-card"><span className="muted">Total</span><strong>{users.length}</strong></div>
      </section>

      <form method="get" className="admin-form-grid" style={{ margin: "1.5rem 0" }}>
        <label>
          Buscar por nombre o email
          <input type="search" name="q" defaultValue={search} placeholder="Nombre o correo" />
        </label>
        <div className="form-actions"><button className="button" type="submit">Buscar</button></div>
      </form>

      <p className="muted">Los registros con email y contraseña quedan pendientes. Revisá las cuentas y aprobá el acceso asignando el rol correspondiente.</p>
      <table className="data-table">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Sueldo</th><th>Alta</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name ?? "-"}</td>
              <td>{user.email}</td>
              <td>{getManagedUserRoleName(user.role as ManagedUserRole)}</td>
              <td>{user.role === "SECRETARY" || user.role === "DRIVER" ? formatCurrency(user.monthlySalaryCents, user.salaryCurrency) : "-"}</td>
              <td>{user.createdAt.toLocaleDateString("es-AR")}</td>
              <td><span className={`status-pill ${user.isActive ? "active" : "inactive"}`}>{user.isActive ? "Activo" : user.role === "USER" ? "Pendiente" : "Inactivo"}</span></td>
              <td>
                <div className="table-actions">
                  <Link className="ghost-button" href={getManagedUserPath(undefined, `/${user.id}`)}>Editar</Link>
                  <form action={setManagedUserActiveAction}>
                    <input type="hidden" name="id" value={user.id} />
                    <input type="hidden" name="isActive" value={user.isActive ? "false" : "true"} />
                    <button className="ghost-button" type="submit">{user.isActive ? "Desactivar" : "Activar"}</button>
                  </form>
                  <form action={deleteManagedUserAction}>
                    <input type="hidden" name="id" value={user.id} />
                    <button className="danger-button" type="submit">Eliminar</button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {users.length === 0 ? <tr><td colSpan={7}>No hay cuentas que coincidan con la búsqueda.</td></tr> : null}
        </tbody>
      </table>
    </AdminShell>
  );
}
