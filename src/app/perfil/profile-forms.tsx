"use client";

import { useActionState } from "react";
import { changePasswordAction, updateProfileAction, type ProfileFormState } from "./actions";

function FormFeedback({ error, message }: ProfileFormState) {
  if (error) return <p className="field-error" role="alert">{error}</p>;
  if (message) return <p className="success" role="status">{message}</p>;
  return null;
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, {});

  return (
    <form className="form-panel" action={action}>
      <h2>Datos personales</h2>
      <label>Nombre<input key={name} name="name" defaultValue={name} autoComplete="name" maxLength={120} required /></label>
      <label>Email<input type="email" value={email} readOnly /></label>
      <FormFeedback {...state} />
      <button className="button" type="submit" disabled={pending}>Guardar nombre</button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});

  return (
    <form className="form-panel" action={action}>
      <h2>Cambiar contraseña</h2>
      <label>Contraseña actual<input name="currentPassword" type="password" autoComplete="current-password" maxLength={72} required /></label>
      <label>Nueva contraseña<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
      <label>Repetir nueva contraseña<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
      <FormFeedback {...state} />
      <button className="button" type="submit" disabled={pending}>Cambiar contraseña</button>
    </form>
  );
}
