"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ManagedUserRole } from "@/lib/admin/users";
import { getManagedUserRoleName, getManagedUserPath, managedUserRoles } from "@/lib/admin/users";
import { AdminFormAlert, AdminSubmitButton, FieldError } from "../form-ui";
import { initialAdminFormState, type AdminFormState } from "../form-state";

type UserFormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
type ManagedUserFormData = {
  id: string;
  email: string;
  name: string | null;
  role: ManagedUserRole;
  isActive: boolean;
  monthlySalaryCents: number | null;
};

export function ManagedUserForm({ action, user }: { action: UserFormAction; user: ManagedUserFormData }) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const errors = state.fieldErrors;

  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      <input type="hidden" name="id" value={user.id} />
      <label>
        Nombre
        <input name="name" defaultValue={user.name ?? ""} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} />
        <FieldError id="name-error" message={errors.name} />
      </label>
      <label>Email<input type="email" value={user.email} readOnly /></label>
      <label>
        Rol
        <select name="role" defaultValue={user.role}>
          {managedUserRoles.map((role) => <option value={role} key={role}>{getManagedUserRoleName(role)}</option>)}
        </select>
      </label>
      <label>
        Estado
        <select name="isActive" defaultValue={user.isActive ? "true" : "false"}>
          <option value="false">Inactivo o pendiente</option>
          <option value="true">Activo</option>
        </select>
      </label>
      <label>
        Sueldo mensual (solo Secretaría o Chofer)
        <input name="monthlySalary" inputMode="decimal" defaultValue={user.monthlySalaryCents ? String(user.monthlySalaryCents / 100) : ""} placeholder="Ej: 450000" aria-invalid={Boolean(errors.monthlySalary)} aria-describedby={errors.monthlySalary ? "monthlySalary-error" : undefined} />
        <FieldError id="monthlySalary-error" message={errors.monthlySalary} />
      </label>
      <div className="form-actions span-2">
        <AdminSubmitButton>Guardar cuenta</AdminSubmitButton>
        <Link className="ghost-button" href={getManagedUserPath()}>Volver a usuarios</Link>
      </div>
    </form>
  );
}
