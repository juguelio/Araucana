"use client";

import { useActionState } from "react";
import { ACCOUNTING_CATEGORY_LABELS, EXPENSE_CATEGORIES } from "@/lib/accounting/types";
import { AdminFormAlert, AdminSubmitButton } from "../form-ui";
import { initialAdminFormState, type AdminFormState } from "../form-state";

type ExpenseFormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

type ExpenseFormProps = {
  combustible?: boolean;
  action: ExpenseFormAction;
  vehicles: Array<{
    id: string;
    name: string;
  }>;
  /** El mes que se está mirando (YYYY-MM): al guardar se vuelve a ese mes. */
  mes?: string;
  /** Fecha sugerida: hoy si es el mes que se mira; si no, el último día de ese mes. */
  fecha?: string;
  /** La sección de Contabilidad desde la que se abrió: al guardar se vuelve a ella. */
  seccion?: string;
};

export function ExpenseForm({ combustible, action, vehicles, mes, fecha, seccion }: ExpenseFormProps) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const today = fecha ?? new Date().toISOString().slice(0, 10);

  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      {mes ? <input type="hidden" name="volverA" value={mes} /> : null}
      {seccion ? <input type="hidden" name="volverSeccion" value={seccion} /> : null}
      {combustible ? <input type="hidden" name="category" value="FUEL" /> : <label>
        Categoría
        <select name="category" required>
          {EXPENSE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {ACCOUNTING_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </label>}
      <label>
        Monto
        <input name="amount" inputMode="decimal" placeholder="Ej: 85000" required />
      </label>
      <label>
        Fecha
        <input name="occurredAt" type="date" defaultValue={today} required />
      </label>
      <label>
        Nave
        <select name="vehicleId">
          <option value="">Sin nave</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.name}
            </option>
          ))}
        </select>
      </label>
      <label className="span-2">
        Nota
        <input name="notes" placeholder="Detalle opcional" />
      </label>
      <div className="form-actions span-2">
        <AdminSubmitButton>Guardar egreso</AdminSubmitButton>
      </div>
    </form>
  );
}
