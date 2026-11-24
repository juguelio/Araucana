"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { suggestInitialPassword } from "@/lib/admin/user-draft";
import type { ManagedUserRole } from "@/lib/admin/users";
import { getManagedUserRoleName, getManagedUserPath, managedUserRoles } from "@/lib/admin/users";
import { AdminFormAlert, FieldError } from "../form-ui";
import { initialAdminFormState, type AdminFormState } from "../form-state";
import { LICENSE_SCOPES } from "@/lib/admin/driver-documents";

type UserFormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
type ManagedUserFormData = {
  id: string;
  email: string;
  name: string | null;
  role: ManagedUserRole;
  isActive: boolean;
  monthlySalaryCents: number | null;
};

/** DNI, licencia y antecedentes ya cargados, con las fechas como "AAAA-MM-DD". */
export type DriverDocumentsFormData = {
  documentNumber: string;
  cuil: string;
  licenseCategory: string;
  licenseScope: string;
  licenseExpiresAt: string;
  criminalRecordExpiresAt: string;
};

type ManagedUserFormProps = {
  action: UserFormAction;
  /** Sin `user`, el formulario da de alta una cuenta nueva. */
  user?: ManagedUserFormData;
  /** Sólo un super administrador puede elegir ese rol; al resto no se le ofrece. */
  canAssignSuperAdmin?: boolean;
  /** Con un rol fijo no hay selector: es el alta de chofer, que la secretaría también puede hacer. */
  fixedRole?: ManagedUserRole;
  /** El sueldo es dato de administración: la secretaría no lo ve. */
  showSalary?: boolean;
  /** A dónde vuelve el botón de atrás: `/admin/usuarios` o `/admin/choferes`. */
  backHref?: string;
  /** Documentación del chofer, si ya la tiene. */
  driverDocuments?: DriverDocumentsFormData | null;
  driverEdit?: boolean;
};

export function ManagedUserForm({ action, user, canAssignSuperAdmin = false, fixedRole, showSalary = true, backHref, driverDocuments, driverEdit = false }: ManagedUserFormProps) {
  // Si la cuenta ya es de un super administrador el rol se muestra igual, para no cambiarlo sin querer.
  const roles = managedUserRoles.filter((role) => role !== "SUPERADMIN" || canAssignSuperAdmin || user?.role === "SUPERADMIN");
  const [state, formAction, pending] = useActionState(action, initialAdminFormState);
  const [password, setPassword] = useState("");
  const errors = state.fieldErrors;
  const creando = !user;
  const [selectedRole, setSelectedRole] = useState<string>(fixedRole ?? user?.role ?? "SECRETARY");
  const esChofer = selectedRole === "DRIVER";

  return (
    // Sin el reseteo automático de React: si el alta vuelve con un error, lo escrito queda en pantalla.
    <form className="admin-form-grid" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      startTransition(() => formAction(data));
    }}>
      <AdminFormAlert state={state} />
      {!creando && <input type="hidden" name="id" value={user.id} />}
      {driverEdit && <input type="hidden" name="driverEdit" value="1" />}
      <label>
        Nombre
        <input name="name" defaultValue={user?.name ?? ""} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} />
        <FieldError id="name-error" message={errors.name} />
      </label>
      {creando ? (
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="off"
            placeholder="nombre@araucana.com.ar"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          <FieldError id="email-error" message={errors.email} />
        </label>
      ) : (
        <label>Email<input type="email" value={user.email} readOnly /></label>
      )}
      <label className="span-2">
        {creando ? "Contraseña inicial" : "Nueva contraseña (opcional)"}
        <span className="password-field">
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={72}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "password-error" : undefined}
          />
          <button className="ghost-button" onClick={() => setPassword(suggestInitialPassword())} type="button">
            Generar
          </button>
        </span>
        <small>
          {creando
            ? "Mínimo 12 caracteres. Copiala antes de guardar: no se vuelve a mostrar."
            : "Si la cambiás, las sesiones de esa cuenta se cerrarán."}
        </small>
        <FieldError id="password-error" message={errors.password} />
      </label>
      {fixedRole ? (
        <label>
          Rol
          <input type="hidden" name="role" value={fixedRole} />
          <span className="muted">{getManagedUserRoleName(fixedRole)}</span>
          <FieldError id="role-error" message={errors.role} />
        </label>
      ) : (
        <label>
          Rol
          <select name="role" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}>
            {roles.map((role) => <option value={role} key={role}>{getManagedUserRoleName(role)}</option>)}
          </select>
          <FieldError id="role-error" message={errors.role} />
        </label>
      )}
      {!driverEdit && <label>
        Estado
        <select name="isActive" defaultValue={user ? (user.isActive ? "true" : "false") : "true"}>
          <option value="false">Inactivo o pendiente</option>
          <option value="true">Activo</option>
        </select>
      </label>}
      {showSalary && (
        <label>
          Sueldo mensual (solo Secretaría o Chofer)
          <input
            name="monthlySalary"
            inputMode="decimal"
            defaultValue={user?.monthlySalaryCents ? String(user.monthlySalaryCents / 100) : ""}
            placeholder="Ej: 450000"
            aria-invalid={Boolean(errors.monthlySalary)}
            aria-describedby={errors.monthlySalary ? "monthlySalary-error" : undefined}
          />
          <FieldError id="monthlySalary-error" message={errors.monthlySalary} />
        </label>
      )}
      {esChofer && (
        <fieldset className="driver-documents">
          <legend>Documentación del chofer</legend>
          <p className="muted driver-documents-note">
            Se pide para todos los choferes. Los vencimientos se marcan en el listado de choferes desde 30 días antes.
          </p>
          <DocField label="DNI" name="documentNumber" defaultValue={driverDocuments?.documentNumber} error={errors.documentNumber} inputMode="numeric" placeholder="Ej: 29098806" required />
          <DocField label="CUIL (opcional)" name="cuil" defaultValue={driverDocuments?.cuil} error={errors.cuil} inputMode="numeric" placeholder="Ej: 27-29098806-9" />
          <DocField label="Categoría de la licencia" name="licenseCategory" defaultValue={driverDocuments?.licenseCategory} error={errors.licenseCategory} placeholder="Ej: D3" required />
          <label>
            Alcance de la licencia
            <select name="licenseScope" defaultValue={driverDocuments?.licenseScope ?? "COMPLETA"}>
              {Object.entries(LICENSE_SCOPES).map(([scope, label]) => <option key={scope} value={scope}>{label}</option>)}
            </select>
            <FieldError id="licenseScope-error" message={errors.licenseScope} />
          </label>
          <DocField label="Vencimiento de la licencia" name="licenseExpiresAt" type="date" defaultValue={driverDocuments?.licenseExpiresAt} error={errors.licenseExpiresAt} required />
          <DocField label="Vencimiento del certificado de antecedentes" name="criminalRecordExpiresAt" type="date" defaultValue={driverDocuments?.criminalRecordExpiresAt} error={errors.criminalRecordExpiresAt} required />
        </fieldset>
      )}
      <div className="form-actions span-2">
        <button className="button" type="submit" disabled={pending}>{pending ? "Guardando..." : creando ? "Crear cuenta" : "Guardar cuenta"}</button>
        <Link className="ghost-button" href={backHref ?? getManagedUserPath()}>Volver</Link>
      </div>
    </form>
  );
}

function DocField({ label, name, error, ...input }: {
  label: string;
  name: string;
  error?: string;
  defaultValue?: string;
  type?: string;
  inputMode?: "numeric";
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input name={name} {...input} aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined} />
      <FieldError id={`${name}-error`} message={error} />
    </label>
  );
}
