"use client";

import { RowModal } from "@/app/admin/reservas/row-modal";
import type { AdminFormState } from "../form-state";
import { ExpenseForm } from "./expense-form";
import { SalaryPaymentForm } from "./salary-payment-form";

type Accion = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

/** «Agregar egreso» como modal (antes un desplegable al medio de la página). */
export function NuevoEgreso({ action, vehicles, mes, fecha, mesLabel, closeKey }: {
  action: Accion;
  vehicles: { id: string; name: string }[];
  mes: string;
  fecha: string;
  mesLabel: string;
  closeKey?: string;
}) {
  return (
    <RowModal trigger="Agregar egreso" triggerLabel="Agregar egreso" triggerClassName="ghost-button" modalClassName="cont-modal" closeKey={closeKey}
      eyebrow="Contabilidad" title="Nuevo egreso" subtitle={`Se suma a ${mesLabel} si la fecha cae en ese mes.`}>
      <ExpenseForm action={action} vehicles={vehicles} mes={mes} fecha={fecha} />
    </RowModal>
  );
}

type Persona = { id: string; name: string | null; email: string; role: string; monthlySalaryCents: number | null };

/**
 * «Registrar pago»: desde la cabecera (elegís a la persona) o desde su fila de «Sueldos del mes», con
 * la persona, el período y lo que falta pagar ya puestos.
 */
export function PagoDeSueldo({ action, users, mes, fecha, userId, montoCents, trigger, triggerClassName, nombre, closeKey }: {
  action: Accion;
  users: Persona[];
  mes: string;
  fecha: string;
  userId?: string;
  montoCents?: number | null;
  trigger: string;
  triggerClassName: string;
  nombre?: string;
  closeKey?: string;
}) {
  return (
    <RowModal trigger={trigger} triggerLabel={nombre ? `Registrar pago de sueldo a ${nombre}` : "Registrar pago de sueldo"} triggerClassName={triggerClassName} closeKey={closeKey}
      modalClassName="cont-modal" eyebrow="Pago de sueldo" title={nombre ?? "Registrar pago"} subtitle="El período es el mes del sueldo, aunque se pague a principio del siguiente.">
      <SalaryPaymentForm action={action} users={users} userId={userId} periodo={mes} fecha={fecha} montoCents={montoCents} />
    </RowModal>
  );
}
