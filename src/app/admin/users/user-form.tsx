"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { suggestInitialPassword } from "@/lib/admin/user-draft";
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

type ManagedUserFormProps = {
  action: UserFormAction;
  /** Sin `user`, el formulario da de alta una cuenta nueva. */
  user?: ManagedUserFormData;
};

export function ManagedUserForm({ action, user }: ManagedUserFormProps) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const [password, setPassword] = useState("");
  const errors = state.fieldErrors;
  const creando = !user;

  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      {!creando && <input type="hidden" name="id" value={user.id} />}
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
      <label>
        Rol
        <select name="role" defaultValue={user?.role ?? "SECRETARY"}>
          {managedUserRoles.map((role) => <option value={role} key={role}>{getManagedUserRoleName(role)}</option>)}
        </select>
        <FieldError id="role-error" message={errors.role} />
      </label>
      <label>
        Estado
        <select name="isActive" defaultValue={user ? (user.isActive ? "true" : "false") : "true"}>
          <option value="false">Inactivo o pendiente</option>
          <option value="true">Activo</option>
        </select>
      </label>
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
      <div className="form-actions span-2">
        <AdminSubmitButton>{creando ? "Crear cuenta" : "Guardar cuenta"}</AdminSubmitButton>
        <Link className="ghost-button" href={getManagedUserPath()}>Volver a usuarios</Link>
      </div>
    </form>
  );
}
