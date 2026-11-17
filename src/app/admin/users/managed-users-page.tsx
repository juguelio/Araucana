import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getManagedUserRoleName, type ManagedUserRole } from "@/lib/admin/users";
import { formatCurrency } from "@/lib/admin/salary";
import { canDeleteManagedUser, canSeeSalary, managedUsersBasePath } from "@/lib/admin/driver-access";
import { getCurrentAdminOrRedirect, getCurrentDriverManagerOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { CrmNavigation } from "../crm-navigation";
import { deleteManagedUserAction, setManagedUserActiveAction } from "./actions";

type ManagedUsersPageProps = {
  role?: ManagedUserRole;
  notice?: string;
  query?: string;
  /**
   * `drivers` es la pantalla de choferes: la abre también la secretaría y muestra menos cosas
   * (sin sueldos y sin borrado). Sin el prop, es el CRM y sigue siendo sólo de administración.
   */
  access?: "admin" | "drivers";
};

export async function ManagedUsersPage({ role, notice, query = "", access = "admin" }: ManagedUsersPageProps) {
  const sessionUser = access === "drivers" ? await getCurrentDriverManagerOrRedirect() : await getCurrentAdminOrRedirect();
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

  const basePath = managedUsersBasePath(sessionUser.role);
  const verSueldo = canSeeSalary(sessionUser.role);
  const puedeBorrar = canDeleteManagedUser(sessionUser.role);
  const esChoferes = access === "drivers";
  const columnas = 6 + (verSueldo ? 1 : 0);

  return (
    <AdminShell role={sessionUser.role}
      title={esChoferes ? "Choferes" : role ? getManagedUserRoleName(role) : "CRM · Usuarios y roles"}
      eyebrow="Panel de administración"
      notice={notice}
      action={<Link className="button" href={`${basePath}/nuevo`}>{esChoferes ? "Crear chofer" : "Crear usuario"}</Link>}
    >
      {!role && !esChoferes && <CrmNavigation current="usuarios" />}
      <section className="admin-grid">
        <div className="admin-card"><span className="muted">{esChoferes ? "Inactivos" : "Pendientes"}</span><strong>{esChoferes ? users.length - activeCount : pendingCount}</strong></div>
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

      <p className="muted">
        {esChoferes
          ? "Los choferes son cuentas con acceso a su planilla del día. Un chofer inactivo no aparece para asignar en «Salidas del día»."
          : "Gestioná desde acá todas las cuentas, sus roles y permisos. Las cuentas pendientes necesitan aprobación antes de acceder."}
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Nombre</th><th>Email</th>{!esChoferes && <th>Rol</th>}{verSueldo && <th>Sueldo</th>}
            <th>Alta</th><th>Estado</th><th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name ?? "-"}</td>
              <td>{user.email}</td>
              {!esChoferes && <td>{getManagedUserRoleName(user.role as ManagedUserRole)}</td>}
              {verSueldo && <td>{user.role === "SECRETARY" || user.role === "DRIVER" ? formatCurrency(user.monthlySalaryCents, user.salaryCurrency) : "-"}</td>}
              <td>{user.createdAt.toLocaleDateString("es-AR")}</td>
              <td><span className={`status-pill ${user.isActive ? "active" : "inactive"}`}>{user.isActive ? "Activo" : user.role === "USER" ? "Pendiente" : "Inactivo"}</span></td>
              <td>
                <div className="table-actions">
                  <Link className="ghost-button" href={`${basePath}/${user.id}`}>Editar</Link>
                  <form action={setManagedUserActiveAction}>
                    <input type="hidden" name="id" value={user.id} />
                    <input type="hidden" name="isActive" value={user.isActive ? "false" : "true"} />
                    <button className="ghost-button" type="submit">{user.isActive ? "Desactivar" : "Activar"}</button>
                  </form>
                  {puedeBorrar && (
                    <form action={deleteManagedUserAction}>
                      <input type="hidden" name="id" value={user.id} />
                      <button className="danger-button" type="submit">Eliminar</button>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {users.length === 0 ? <tr><td colSpan={columnas}>{esChoferes ? "Todavía no hay choferes cargados." : "No hay cuentas que coincidan con la búsqueda."}</td></tr> : null}
        </tbody>
      </table>
    </AdminShell>
  );
}
