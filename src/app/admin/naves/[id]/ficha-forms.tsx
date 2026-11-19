"use client";

import { useActionState } from "react";
import { GRAVEDADES, GRAVEDAD_LABEL } from "@/lib/vehicles/ficha";
import { ESTADOS_DE_ITEM, ESTADO_DE_ITEM_LABEL, SECCIONES_DE_SERVICE } from "@/lib/vehicles/service-sheet";
import { AdminFormAlert, AdminSubmitButton, FieldError } from "../../form-ui";
import { initialAdminFormState, type AdminFormState } from "../../form-state";

type FormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

function hoyEnArgentina() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

/** Anotar un daño de la nave: qué pasó, cuándo y qué tan grave es. */
export function DamageForm({ action, vehicleId, panelDate }: { action: FormAction; vehicleId: string; panelDate?: string }) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const errors = state.fieldErrors;
  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      <input type="hidden" name="vehicleId" value={vehicleId} />
      {panelDate && <input type="hidden" name="panelDate" value={panelDate} />}
      <label className="span-2">
        Qué se dañó
        <textarea
          name="description"
          rows={2}
          maxLength={500}
          placeholder="Ej: rayón en la puerta lateral derecha, espejo roto, ruido en el tren delantero"
          required
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? "danio-description-error" : undefined}
        />
        <FieldError id="danio-description-error" message={errors.description} />
      </label>
      <label>
        Fecha
        <input
          name="occurredAt"
          type="date"
          defaultValue={hoyEnArgentina()}
          required
          aria-invalid={Boolean(errors.occurredAt)}
          aria-describedby={errors.occurredAt ? "danio-occurredAt-error" : undefined}
        />
        <FieldError id="danio-occurredAt-error" message={errors.occurredAt} />
      </label>
      <label>
        Gravedad
        <select name="severity" defaultValue="LEVE" aria-invalid={Boolean(errors.severity)}>
          {GRAVEDADES.map((g) => (
            <option key={g} value={g}>
              {GRAVEDAD_LABEL[g]}
              {g === "GRAVE" ? " (no debería salir)" : ""}
            </option>
          ))}
        </select>
        <FieldError id="danio-severity-error" message={errors.severity} />
      </label>
      <label>
        Quién lo informó
        <input name="reportedBy" maxLength={120} placeholder="Chofer, mecánico…" />
      </label>
      <label>
        Nota
        <input name="notes" maxLength={1000} placeholder="Detalle opcional" />
      </label>
      <div className="form-actions span-2">
        <AdminSubmitButton>Anotar daño</AdminSubmitButton>
      </div>
    </form>
  );
}

/** Registrar un arreglo: es un egreso «Arreglo» de contabilidad con esta nave, y puede cerrar un daño. */
export function RepairForm({
  action,
  vehicleId,
  danios,
  danioElegido
}: {
  action: FormAction;
  vehicleId: string;
  danios: Array<{ id: string; label: string }>;
  danioElegido?: string;
}) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <label>
        Monto
        <input name="amount" inputMode="decimal" placeholder="Ej: 85000" required />
      </label>
      <label>
        Fecha
        <input name="occurredAt" type="date" defaultValue={hoyEnArgentina()} required />
      </label>
      <label className="span-2">
        Qué se arregló
        <input name="notes" maxLength={1000} placeholder="Ej: cambio de pastillas y discos, taller Pérez" />
      </label>
      {danios.length > 0 ? (
        <label className="span-2">
          Daño que repara
          <select name="damageId" defaultValue={danioElegido ?? ""}>
            <option value="">Ninguno (mantenimiento u otro arreglo)</option>
            {danios.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="form-actions span-2">
        <AdminSubmitButton>Registrar arreglo</AdminSubmitButton>
      </div>
    </form>
  );
}

/**
 * Planilla de service: la misma planilla de papel del taller, ítem por ítem. Cada ítem se deja como
 * «sin revisar», «bien», «falla» o «no aplica»; el que no se toca no suma al resumen.
 */
export function ServiceSheetForm({ action, vehicleId }: { action: FormAction; vehicleId: string }) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const errors = state.fieldErrors;
  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <label>
        Fecha del service
        <input
          name="servicedAt"
          type="date"
          defaultValue={hoyEnArgentina()}
          required
          aria-invalid={Boolean(errors.servicedAt)}
          aria-describedby={errors.servicedAt ? "service-servicedAt-error" : undefined}
        />
        <FieldError id="service-servicedAt-error" message={errors.servicedAt} />
      </label>
      <label>
        Kilometraje
        <input
          name="odometerKm"
          inputMode="numeric"
          placeholder="148.320"
          required
          aria-invalid={Boolean(errors.odometerKm)}
          aria-describedby={errors.odometerKm ? "service-odometerKm-error" : undefined}
        />
        <FieldError id="service-odometerKm-error" message={errors.odometerKm} />
      </label>

      <div className="span-2 service-bloques">
        {SECCIONES_DE_SERVICE.map((seccion) => (
          <fieldset className="service-bloque" key={seccion.id}>
            <legend>{seccion.label}</legend>
            {seccion.items.map((item) => (
              <label className="service-item" key={item.id}>
                <span>{item.label}</span>
                <select name={`check:${item.id}`} defaultValue="" aria-label={`${seccion.label}: ${item.label}`}>
                  <option value="">—</option>
                  {ESTADOS_DE_ITEM.map((estado) => (
                    <option key={estado} value={estado}>
                      {ESTADO_DE_ITEM_LABEL[estado]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
        ))}
      </div>

      <label className="span-2">
        Qué se le hizo
        <textarea name="workDone" rows={2} maxLength={500} placeholder="Ej: cambio de aceite y filtros, pastillas delanteras, alineación" />
      </label>
      <label className="span-2">
        Observaciones
        <textarea name="notes" rows={2} maxLength={500} placeholder="Cualquier cosa que tenga que saber el próximo que la agarre" />
      </label>
      <div className="span-2">
        <AdminSubmitButton>Guardar planilla</AdminSubmitButton>
      </div>
    </form>
  );
}
