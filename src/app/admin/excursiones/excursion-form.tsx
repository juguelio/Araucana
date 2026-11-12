"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { initialAdminFormState, type AdminFormState } from "../form-state";
import { AdminFormAlert, AdminSubmitButton, FieldError } from "../form-ui";
import styles from "./excursiones.module.css";

type ExcursionFormData = {
  name: string;
  description: string;
  duration: string;
  priceCents: number | null;
  currency: string;
  isPublished: boolean;
  departures: string[];
};

type ExcursionFormProps = {
  action: (state: AdminFormState, form: FormData) => Promise<AdminFormState>;
  excursion?: ExcursionFormData;
  photoCount?: number;
};

export function ExcursionForm({ action, excursion, photoCount = 0 }: ExcursionFormProps) {
  const [state, formAction, pending] = useActionState(action, initialAdminFormState);
  // Controlled fields keep the operator's edits when a server validation fails.
  const [name, setName] = useState(excursion?.name ?? "");
  const [description, setDescription] = useState(excursion?.description ?? "");
  const [duration, setDuration] = useState(excursion?.duration ?? "");
  const [price, setPrice] = useState(excursion?.priceCents == null ? "" : (excursion.priceCents / 100).toFixed(2));
  const [currency, setCurrency] = useState(excursion?.currency ?? "ARS");
  const [isPublished, setIsPublished] = useState(excursion?.isPublished ?? false);
  const [departures, setDepartures] = useState<string[]>(excursion?.departures ?? []);
  const canPublish = photoCount > 0;
  const errors = state.fieldErrors;

  return (
    <form className={`admin-form-grid ${styles.form}`} action={formAction} aria-busy={pending}>
      <AdminFormAlert state={state} />
      <label className="span-2">
        Nombre de la excursión
        <input name="name" value={name} onChange={(event) => setName(event.target.value)} required
          aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "excursion-name-error" : undefined} />
        <FieldError id="excursion-name-error" message={errors.name} />
      </label>
      <label className="span-2">
        Descripción
        <textarea name="description" rows={6} value={description} onChange={(event) => setDescription(event.target.value)} required
          aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "excursion-description-error" : undefined} />
        <FieldError id="excursion-description-error" message={errors.description} />
      </label>
      <label className="span-2">
        Duración
        <input name="duration" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="4 h / día completo" required
          aria-invalid={Boolean(errors.duration)} aria-describedby="excursion-duration-help excursion-duration-error" />
        <small id="excursion-duration-help" className={styles.help}>Texto libre, por ejemplo: 4 h o día completo.</small>
        <FieldError id="excursion-duration-error" message={errors.duration} />
      </label>
      <label>
        Precio (opcional)
        <input name="price" type="text" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)}
          placeholder="Ej. 45000.50" aria-invalid={Boolean(errors.price)} aria-describedby="excursion-price-help excursion-price-error" />
        <small id="excursion-price-help" className={styles.help}>Sin separadores de miles. Vacío: precio a consultar.</small>
        <FieldError id="excursion-price-error" message={errors.price} />
      </label>
      <label>
        Moneda
        <select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)}
          aria-invalid={Boolean(errors.currency)} aria-describedby={errors.currency ? "excursion-currency-error" : undefined}>
          <option value="ARS">ARS · Pesos argentinos</option>
          <option value="USD">USD · Dólares estadounidenses</option>
        </select>
        <FieldError id="excursion-currency-error" message={errors.currency} />
      </label>

      <fieldset className={`span-2 ${styles.departures}`} aria-describedby="excursion-departures-help excursion-departures-error">
        <legend>Fechas de salida</legend>
        <p id="excursion-departures-help" className={styles.help}>
          Hora argentina (UTC−3), independientemente de la zona horaria de tu equipo. Podés guardar la excursión sin fechas.
          Máximo: 100 salidas. Las fechas anteriores se conservan hasta que las quites.
        </p>
        <input type="hidden" name="departures" value={JSON.stringify(departures)} />
        {departures.length === 0 && <p className={styles.help}>Sin fechas cargadas. En la web se mostrará «Sin próximas fechas».</p>}
        <div className={styles.departureList}>
          {departures.map((departure, index) => (
            <div className={styles.departureRow} key={index}>
              <label>
                Salida {index + 1}
                <input type="datetime-local" value={departure} required step="60"
                  aria-invalid={Boolean(errors.departures)}
                  onChange={(event) => setDepartures((current) => current.map((value, position) => position === index ? event.target.value : value))} />
              </label>
              <button type="button" className="ghost-button" disabled={pending} aria-label={`Quitar salida ${index + 1}`}
                onClick={() => setDepartures((current) => current.filter((_, position) => position !== index))}>Quitar</button>
            </div>
          ))}
        </div>
        <FieldError id="excursion-departures-error" message={errors.departures} />
        <button type="button" className="ghost-button" disabled={pending || departures.length >= 100}
          onClick={() => setDepartures((current) => [...current, ""])}>Agregar fecha de salida</button>
        <small className={styles.help}>{departures.length} / 100 salidas</small>
      </fieldset>

      <div className={`span-2 ${styles.publication}`}>
        <label className="checkbox-row">
          <input name="isPublished" type="checkbox" checked={canPublish && isPublished} disabled={!canPublish}
            onChange={(event) => setIsPublished(event.target.checked)} aria-describedby="excursion-publish-help excursion-publish-error"
            aria-invalid={Boolean(errors.isPublished)} />
          Publicar en la web
        </label>
        <p id="excursion-publish-help" className={styles.help}>
          {canPublish ? "Si desmarcás esta opción, se guardará como borrador y no será visible al público."
            : "Primero guardá el borrador y cargá al menos una foto para poder publicarlo."}
        </p>
        <FieldError id="excursion-publish-error" message={errors.isPublished} />
      </div>
      <div className="form-actions span-2">
        <AdminSubmitButton>{excursion ? "Guardar cambios" : "Crear borrador"}</AdminSubmitButton>
        <Link className="ghost-button" href="/admin/excursiones">Volver al listado</Link>
      </div>
    </form>
  );
}

export function DeleteExcursionForm({ action, name }: { action: (form: FormData) => Promise<void>; name: string }) {
  const [confirmation, setConfirmation] = useState("");

  return (
    <details className={styles.danger}>
      <summary>Eliminar excursión</summary>
      <p>Se eliminará «{name}» junto con todas sus fotos y fechas de salida. Esta acción no se puede deshacer.</p>
      <form action={action} className={`admin-form-grid ${styles.form}`} onSubmit={(event) => {
        if (confirmation !== "ELIMINAR") event.preventDefault();
      }}>
        <label className="span-2">
          Escribí ELIMINAR para confirmar
          <input name="confirm" value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
            required pattern="ELIMINAR" autoComplete="off" spellCheck={false} />
        </label>
        <div className="form-actions span-2">
          {confirmation === "ELIMINAR" ? <AdminSubmitButton>Eliminar definitivamente</AdminSubmitButton>
            : <button type="submit" className="danger-button" disabled>Eliminar definitivamente</button>}
        </div>
      </form>
    </details>
  );
}
