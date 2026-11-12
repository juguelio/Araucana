"use client";

import { useActionState, useState } from "react";
import { initialAdminFormState, type AdminFormState } from "../form-state";
import { AdminFormAlert, AdminSubmitButton, FieldError } from "../form-ui";
import styles from "./excursiones.module.css";

const maxPhotoBytes = 3 * 1024 * 1024;
const photoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ExcursionPhotoForm({ action }: {
  action: (state: AdminFormState, form: FormData) => Promise<AdminFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialAdminFormState);
  const [clientError, setClientError] = useState("");
  const error = clientError || state.fieldErrors.photo;

  return (
    <form action={formAction} className={`admin-form-grid ${styles.form}`} aria-busy={pending}>
      <AdminFormAlert state={state} />
      <label className="span-2">
        Agregar una foto
        <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required
          aria-invalid={Boolean(error)} aria-describedby="excursion-photo-help excursion-photo-error"
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            const message = !file ? "" : !photoTypes.has(file.type) ? "Elegí una imagen JPEG, PNG o WebP."
              : file.size > maxPhotoBytes ? "La foto no puede superar los 3 MB." : "";
            input.setCustomValidity(message);
            setClientError(message);
          }} />
        <small id="excursion-photo-help" className={styles.help}>Una imagen por carga. JPEG, PNG o WebP; máximo 3 MB. La primera foto será la portada.</small>
        <FieldError id="excursion-photo-error" message={error} />
      </label>
      <div className="form-actions span-2">
        <AdminSubmitButton>Subir foto</AdminSubmitButton>
      </div>
    </form>
  );
}
