"use client";

import { useActionState, useMemo, useState } from "react";
import { AdminFormAlert, AdminSubmitButton } from "../form-ui";
import { initialAdminFormState, type AdminFormState } from "../form-state";

type SalaryPaymentFormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

type SalaryUser = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  monthlySalaryCents: number | null;
};

type SalaryPaymentFormProps = {
  action: SalaryPaymentFormAction;
  users: SalaryUser[];
  /** Desde la fila de «Sueldos del mes»: la persona, el período y lo que falta pagar ya puestos. */
  userId?: string;
  periodo?: string;
  fecha?: string;
  montoCents?: number | null;
  /** La sección de Contabilidad desde la que se abrió: al guardar se vuelve a ella. */
  seccion?: string;
};

function userLabel(user: SalaryUser) {
  const role = user.role === "DRIVER" ? "Chofer" : "Secretaria";
  return `${user.name || user.email} · ${role}`;
}

export function centsToAmount(cents: number | null) {
  // El input entiende coma decimal (parseCurrencyToCents saca los puntos de miles): 79999.5
  // tenía que viajar como «79999,5», no como «79999.5».
  return cents ? String(cents / 100).replace(".", ",") : "";
}

export function SalaryPaymentForm({ action, users, userId, periodo, fecha, montoCents, seccion }: SalaryPaymentFormProps) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const [selectedUserId, setSelectedUserId] = useState(userId ?? users[0]?.id ?? "");
  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId),
    [selectedUserId, users]
  );
  const today = fecha ?? new Date().toISOString().slice(0, 10);
  const currentMonth = periodo ?? new Date().toISOString().slice(0, 7);
  // El monto sugerido: lo que falta pagar de esa persona (si vino de su fila); si no, su sueldo mensual.
  const sugerido = selectedUserId === userId && montoCents ? montoCents : selectedUser?.monthlySalaryCents ?? null;

  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      {periodo ? <input type="hidden" name="volverA" value={periodo} /> : null}
      {seccion ? <input type="hidden" name="volverSeccion" value={seccion} /> : null}
      <label className="span-2">
        Persona
        <select name="userId" required value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {userLabel(user)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Período
        <input name="salaryPeriod" type="month" defaultValue={currentMonth} required />
      </label>
      <label>
        Fecha de pago
        <input name="occurredAt" type="date" defaultValue={today} required />
      </label>
      <label>
        Monto
        <input
          key={selectedUserId}
          name="amount"
          inputMode="decimal"
          defaultValue={centsToAmount(sugerido)}
          placeholder="Ej: 450000"
          required
        />
      </label>
      <label className="span-2">
        Nota
        <input name="notes" placeholder="Detalle opcional" />
      </label>
      <div className="form-actions span-2">
        <AdminSubmitButton>Registrar pago</AdminSubmitButton>
      </div>
    </form>
  );
}
