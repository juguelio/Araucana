import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getManagedUserRoleName, type ManagedUserRole } from "@/lib/admin/users";
import { formatCurrency } from "@/lib/admin/salary";
import { canDeleteManagedUser, canSeeSalary, managedUsersBasePath } from "@/lib/admin/driver-access";
import { getCurrentAdminOrRedirect, getCurrentDriverManagerOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { EXPIRY_LABELS, LICENSE_SCOPES, expiryStatus, todayInArgentina, worstStatus, type ExpiryStatus, type LicenseScope } from "@/lib/admin/driver-documents";
import { CrmNavigation } from "../crm-navigation";
import "./users.css";
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
    select: {
      id: true, email: true, name: true, role: true, isActive: true, monthlySalaryCents: true, salaryCurrency: true, createdAt: true,
      driverProfile: { select: { documentNumber: true, licenseCategory: true, licenseScope: true, licenseExpiresAt: true, criminalRecordExpiresAt: true } }
    }
  });
  const pendingCount = users.filter((user) => !user.isActive && user.role === "USER").length;
  const activeCount = users.filter((user) => user.isActive).length;

  const basePath = managedUsersBasePath(sessionUser.role);
  const verSueldo = canSeeSalary(sessionUser.role);
  const puedeBorrar = canDeleteManagedUser(sessionUser.role);
  const esChoferes = access === "drivers";
  // La documentación (DNI, licencia y antecedentes) se ve en el listado de choferes.
  const verDocumentacion = esChoferes || role === "DRIVER";
  const hoy = todayInArgentina();
  const documentacion = (user: (typeof users)[number]) => {
    const licencia = expiryStatus(user.driverProfile?.licenseExpiresAt, hoy);
    const antecedentes = expiryStatus(user.driverProfile?.criminalRecordExpiresAt, hoy);
    return { licencia, antecedentes, peor: worstStatus([licencia, antecedentes]) };
  };
  const aRevisar = verDocumentacion ? users.filter((user) => user.isActive && documentacion(user).peor !== "VALID").length : 0;
  const columnas = 6 + (verSueldo ? 1 : 0) + (verDocumentacion ? 3 : 0);

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
        {verDocumentacion && (
          <div className="admin-card"><span className="muted">Documentación a revisar</span><strong>{aRevisar}</strong></div>
        )}
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
            <th>Nombre</th><th>Email</th>{!esChoferes && <th>Rol</th>}
            {verDocumentacion && <><th>DNI</th><th>Licencia</th><th>Antecedentes</th></>}
            {verSueldo && <th>Sueldo</th>}
            <th>Alta</th><th>Estado</th><th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name ?? "-"}</td>
              <td>{user.email}</td>
              {!esChoferes && <td>{getManagedUserRoleName(user.role as ManagedUserRole)}</td>}
              {verDocumentacion && (
                <>
                  <td>{user.driverProfile?.documentNumber ?? <ExpiryPill status="MISSING" />}</td>
                  <td>
                    {user.driverProfile ? (
                      <span className="driver-doc">
                        {user.driverProfile.licenseCategory} · {LICENSE_SCOPES[user.driverProfile.licenseScope as LicenseScope] ?? user.driverProfile.licenseScope}
                        <small>vence {formatDay(user.driverProfile.licenseExpiresAt)}</small>
                      </span>
                    ) : null}
                    <ExpiryPill status={documentacion(user).licencia} />
                  </td>
                  <td>
                    {user.driverProfile ? <span className="driver-doc"><small>vence {formatDay(user.driverProfile.criminalRecordExpiresAt)}</small></span> : null}
                    <ExpiryPill status={documentacion(user).antecedentes} />
                  </td>
                </>
              )}
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

function formatDay(date: Date) {
  return date.toISOString().slice(0, 10).split("-").reverse().join("/");
}

/** Vigente en verde; por vencer, vencido o faltante, marcado para revisar. */
function ExpiryPill({ status }: { status: ExpiryStatus }) {
  return <span className={`status-pill ${status === "VALID" ? "active" : "inactive"}`} data-vencimiento={status}>{EXPIRY_LABELS[status]}</span>;
}
