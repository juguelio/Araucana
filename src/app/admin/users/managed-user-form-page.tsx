import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { canDeleteManagedUser, canManageManagedUser, canSeeSalary, forcedManagedRole, managedUsersBasePath } from "@/lib/admin/driver-access";
import { getCurrentAdminOrRedirect, getCurrentDriverManagerOrRedirect } from "@/lib/auth/admin";
import { toPublicRole } from "@/lib/auth/roles";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { prisma } from "@/lib/db/prisma";
import { EXPIRY_LABELS, dayKey, expiryDaysLabel, expiryStatus, formatExpiryDay, todayInArgentina } from "@/lib/admin/driver-documents";
import { createManagedUserAction, deleteManagedUserAction, setManagedUserActiveAction, updateManagedUserAction } from "./actions";
import { ConfirmVehicleButton } from "../naves/[id]/confirm-vehicle-button";
import { ManagedUserForm } from "./user-form";
import "./users.css";

/**
 * Alta de una cuenta. Con `fixedRole` el rol no se elige: es el caso de «Crear chofer» desde
 * `/admin/choferes`, que además abre a la secretaría.
 */
export async function CreateManagedUserPage({ fixedRole }: { fixedRole?: "DRIVER" } = {}) {
  const actor = fixedRole ? await getCurrentDriverManagerOrRedirect() : await getCurrentAdminOrRedirect();
  const esChofer = fixedRole === "DRIVER";

  return (
    <AdminShell role={actor.role} eyebrow="Panel de administración" title={esChofer ? "Nuevo chofer" : "Nueva cuenta"}>
      <section className="plain-card admin-section">
        <h2>{esChofer ? "Crear chofer" : "Crear usuario"}</h2>
        <p className="muted">
          {esChofer
            ? "El chofer entra a la app con su email y contraseña para ver la planilla del día. Queda activo al crearse: si lo dejás inactivo, no aparece para asignar en «Salidas del día»."
            : "La cuenta queda activa al crearse. Entregale el email y la contraseña inicial; puede cambiarla desde su perfil."}
        </p>
        <ManagedUserForm
          action={createManagedUserAction}
          canAssignSuperAdmin={isSuperAdmin(actor)}
          fixedRole={fixedRole}
          showSalary={canSeeSalary(actor.role)}
          backHref={managedUsersBasePath(actor.role)}
        />
      </section>
    </AdminShell>
  );
}

/**
 * Edición de una cuenta. `driversOnly` es la ficha que abre la secretaría: sólo cuentas de chofer y
 * sin poder cambiar el rol.
 */
export async function EditManagedUserPage({ id, driversOnly = false, notice }: { id: string; driversOnly?: boolean; notice?: string }) {
  const actor = driversOnly ? await getCurrentDriverManagerOrRedirect() : await getCurrentAdminOrRedirect();
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, role: true, isActive: true, monthlySalaryCents: true,
      driverProfile: { select: { documentNumber: true, cuil: true, licenseCategory: true, licenseScope: true, licenseExpiresAt: true, criminalRecordExpiresAt: true } }
    }
  });
  if (!user || (driversOnly && user.role !== "DRIVER")) notFound();
  if (!canManageManagedUser(actor.role, user.role)) notFound();

  const fixedRole = driversOnly && forcedManagedRole(actor.role) === "DRIVER" ? ("DRIVER" as const) : undefined;

  return (
    <AdminShell role={actor.role} title={driversOnly ? "Editar chofer" : "Editar cuenta"} notice={notice}
      action={driversOnly ? <Link className="ghost-button" href={`/admin/choferes/${user.id}/actividad`}>Ver actividad</Link> : undefined}>
      <section className="plain-card admin-section">
        <h2>{user.name ?? user.email}</h2>
        {user.role === "DRIVER" && !user.driverProfile ? (
          <p className="form-alert error">Falta la documentación de este chofer: completá DNI, licencia y antecedentes para guardar.</p>
        ) : null}
        {user.role === "DRIVER" && user.driverProfile ? (
          <DriverExpirySummary
            licencia={user.driverProfile.licenseExpiresAt}
            antecedentes={user.driverProfile.criminalRecordExpiresAt}
          />
        ) : null}
        <ManagedUserForm
          action={updateManagedUserAction}
          user={{ id: user.id, email: user.email, name: user.name, isActive: user.isActive, monthlySalaryCents: user.monthlySalaryCents, role: toPublicRole(user.role) }}
          driverDocuments={user.driverProfile ? {
            documentNumber: user.driverProfile.documentNumber,
            cuil: user.driverProfile.cuil ?? "",
            licenseCategory: user.driverProfile.licenseCategory,
            licenseScope: user.driverProfile.licenseScope,
            licenseExpiresAt: dayKey(user.driverProfile.licenseExpiresAt),
            criminalRecordExpiresAt: dayKey(user.driverProfile.criminalRecordExpiresAt)
          } : null}
          canAssignSuperAdmin={isSuperAdmin(actor)}
          fixedRole={fixedRole}
          showSalary={canSeeSalary(actor.role)}
          driverEdit={driversOnly}
          backHref={driversOnly ? "/admin/choferes" : managedUsersBasePath(actor.role)}
        />
      </section>
      {driversOnly && (
        <section className="plain-card admin-section">
          <h2>Acceso a la cuenta</h2>
          <div className="inline-actions">
            <span className={`status-pill ${user.isActive ? "active" : "inactive"}`}>{user.isActive ? "Activo" : "Inactivo"}</span>
            <form action={setManagedUserActiveAction}>
              <input type="hidden" name="driverEdit" value="1" />
              <input type="hidden" name="id" value={user.id} />
              <input type="hidden" name="isActive" value={user.isActive ? "false" : "true"} />
              <button className="ghost-button" type="submit">{user.isActive ? "Desactivar" : "Activar"}</button>
            </form>
            {canDeleteManagedUser(actor.role) && (
              <form action={deleteManagedUserAction}>
                <input type="hidden" name="driverEdit" value="1" />
                <input type="hidden" name="id" value={user.id} />
                <ConfirmVehicleButton className="danger-button" label="Eliminar chofer"
                  pregunta={`¿Eliminar la cuenta de ${user.name ?? user.email}? No se puede deshacer.`} />
              </form>
            )}
          </div>
        </section>
      )}
    </AdminShell>
  );
}

/**
 * Estado de los vencimientos en la ficha del chofer (#368): al entrar se ve si la licencia o los
 * antecedentes están vencidos o por vencer, sin abrir el listado ni restar fechas a mano.
 */
function DriverExpirySummary({ licencia, antecedentes }: { licencia: Date; antecedentes: Date }) {
  const hoy = todayInArgentina();
  const documentos = [
    { etiqueta: "Licencia de conducir", vence: licencia },
    { etiqueta: "Certificado de antecedentes", vence: antecedentes }
  ];
  return (
    <div className="driver-expiry">
      <p className="muted">Vencimientos de la documentación:</p>
      <ul>
        {documentos.map((documento) => {
          const estado = expiryStatus(documento.vence, hoy);
          return (
            <li key={documento.etiqueta}>
              <span className="driver-expiry-doc">{documento.etiqueta}</span>
              <span className="muted">{formatExpiryDay(documento.vence)} · {expiryDaysLabel(documento.vence, hoy)}</span>
              <span className={`status-pill ${estado === "VALID" ? "active" : "inactive"}`} data-vencimiento={estado}>{EXPIRY_LABELS[estado]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
