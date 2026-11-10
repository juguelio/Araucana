"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { FleetConflictWarning } from "../fleet-assignment-form";
import { AdminFormAlert, FieldError } from "../form-ui";
import { initialAdminFormState, type AdminFormState } from "../form-state";

type ScheduleFormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

type RouteOption = {
  id: string;
  from: string;
  to: string;
  isActive: boolean;
};

type VehicleOption = {
  id: string;
  name: string;
  _count: {
    seats: number;
  };
};

type ScheduleFormData = {
  id?: string;
  routeId?: string;
  vehicleId?: string;
  departureAt?: Date;
  status?: string;
};

function formatDateTimeInput(date?: Date) {
  if (!date) {
    return undefined;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Salta"
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

type ScheduleFormProps = {
  action: ScheduleFormAction;
  routes: RouteOption[];
  vehicles: VehicleOption[];
  schedule?: ScheduleFormData;
  submitLabel: string;
};

export function ScheduleForm({ action, routes, vehicles, schedule, submitLabel }: ScheduleFormProps) {
  const [state, dispatch, pending] = useActionState(action, initialAdminFormState);
  const errors = state.fieldErrors;

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget, event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : undefined);
      startTransition(() => dispatch(data));
    }}>
      <fieldset className="admin-form-grid" disabled={pending}>
      <AdminFormAlert state={state} />
      {schedule?.id ? <input type="hidden" name="id" value={schedule.id} /> : null}
      <label>
        Ruta
        <select
          name="routeId"
          defaultValue={schedule?.routeId}
          required
          aria-invalid={Boolean(errors.routeId)}
          aria-describedby={errors.routeId ? "routeId-error" : undefined}
        >
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.from} → {route.to}{route.isActive ? "" : " (inactiva)"}
            </option>
          ))}
        </select>
        <FieldError id="routeId-error" message={errors.routeId} />
      </label>
      <label>
        Vehiculo
        <select
          name="vehicleId"
          defaultValue={schedule?.vehicleId}
          required
          aria-invalid={Boolean(errors.vehicleId)}
          aria-describedby={errors.vehicleId ? "vehicleId-error" : undefined}
        >
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.name} · {vehicle._count.seats} asientos
            </option>
          ))}
        </select>
        <FieldError id="vehicleId-error" message={errors.vehicleId} />
      </label>
      <label>
        Fecha y hora
        <input
          name="departureAt"
          type="datetime-local"
          defaultValue={formatDateTimeInput(schedule?.departureAt)}
          required
          aria-invalid={Boolean(errors.departureAt)}
          aria-describedby={errors.departureAt ? "departureAt-error" : undefined}
        />
        <FieldError id="departureAt-error" message={errors.departureAt} />
      </label>
      <label>
        Estado
        <select
          name="status"
          defaultValue={schedule?.status ?? "OPEN"}
          required
          aria-invalid={Boolean(errors.status)}
          aria-describedby={errors.status ? "status-error" : undefined}
        >
          <option value="OPEN">Abierta</option>
          <option value="DOCUMENTATION">Documentacion</option>
          <option value="CLOSED">Inactiva / cerrada</option>
        </select>
        <FieldError id="status-error" message={errors.status} />
      </label>
      <FleetConflictWarning conflicts={state.conflicts} confirmation={state.confirmation} />
      <div className="form-actions span-2">
        <button className="button" type="submit">{pending ? "Guardando…" : submitLabel}</button>
        <Link className="ghost-button" href={schedule?.routeId ? `/admin/rutas/${schedule.routeId}/salidas` : "/admin/rutas"}>Cancelar</Link>
      </div>
      </fieldset>
    </form>
  );
}
