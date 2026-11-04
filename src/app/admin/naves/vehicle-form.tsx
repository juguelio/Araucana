"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { AdminFormAlert, AdminSubmitButton, FieldError } from "../form-ui";
import { initialAdminFormState, type AdminFormState } from "../form-state";
import type { VehicleLayoutMarker } from "@/lib/vehicles/layout-markers";
import { VEHICLE_TEMPLATES, type VehicleSeat } from "@/lib/vehicles/templates";
import { SeatLayoutEditor } from "./seat-layout-editor";

type VehicleFormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

type VehicleFormData = {
  id?: string;
  name?: string;
  brand?: string;
  model?: string;
  licensePlate?: string | null;
  templateKey?: string | null;
  layoutMarkers?: unknown;
  isActive?: boolean;
  seats?: VehicleSeat[];
  internalNumber?: string | null;
  owner?: string | null;
  year?: number | null;
  acquiredAt?: Date | null;
  technicalInspectionDueAt?: Date | null;
  rtoDueAt?: Date | null;
  insurer?: string | null;
  policyDueAt?: Date | null;
  publicTransport?: boolean;
  kind?: string;
  notes?: string | null;
};

/** `input[type=date]` necesita aaaa-mm-dd, sin zona horaria. */
function inputDate(fecha: Date | null | undefined): string {
  if (!fecha) return "";
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

type VehicleFormProps = {
  action: VehicleFormAction;
  vehicle?: VehicleFormData;
  submitLabel: string;
};

export function VehicleForm({ action, vehicle, submitLabel }: VehicleFormProps) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const errors = state.fieldErrors;
  const initialTemplate = vehicle?.templateKey ?? "";
  const [templateKey, setTemplateKey] = useState(initialTemplate);
  const selectedTemplate = useMemo(() => VEHICLE_TEMPLATES.find((template) => template.key === templateKey), [templateKey]);
  const brandValue = selectedTemplate?.brand ?? vehicle?.brand ?? "";
  const modelValue = selectedTemplate?.model ?? vehicle?.model ?? "";
  const seatKey = `${templateKey}-${vehicle?.id ?? "new"}`;
  const layoutMarkers = Array.isArray(vehicle?.layoutMarkers) ? (vehicle.layoutMarkers as VehicleLayoutMarker[]) : [];

  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      {vehicle?.id ? <input type="hidden" name="id" value={vehicle.id} /> : null}
      <label>
        Nombre interno
        <input
          name="name"
          defaultValue={vehicle?.name}
          placeholder="Araucana Norte"
          required
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "name-error" : undefined}
        />
        <FieldError id="name-error" message={errors.name} />
      </label>
      <label>
        Plantilla
        <select
          name="templateKey"
          value={templateKey}
          onChange={(event) => setTemplateKey(event.target.value)}
          aria-invalid={Boolean(errors.templateKey)}
          aria-describedby={errors.templateKey ? "templateKey-error" : undefined}
        >
          <option value="">Carga manual</option>
          {VEHICLE_TEMPLATES.map((template) => (
            <option key={template.key} value={template.key}>
              {template.brand} · {template.model}
            </option>
          ))}
        </select>
        <FieldError id="templateKey-error" message={errors.templateKey} />
      </label>
      <label>
        Marca
        <input
          name="brand"
          key={`brand-${templateKey}`}
          defaultValue={brandValue}
          placeholder="Mercedes-Benz"
          required
          aria-invalid={Boolean(errors.brand)}
          aria-describedby={errors.brand ? "brand-error" : undefined}
        />
        <FieldError id="brand-error" message={errors.brand} />
      </label>
      <label>
        Modelo
        <input
          name="model"
          key={`model-${templateKey}`}
          defaultValue={modelValue}
          placeholder="Sprinter Minibus"
          required
          aria-invalid={Boolean(errors.model)}
          aria-describedby={errors.model ? "model-error" : undefined}
        />
        <FieldError id="model-error" message={errors.model} />
      </label>
      <label>
        Patente / identificador
        <input name="licensePlate" defaultValue={vehicle?.licensePlate ?? ""} placeholder="AE 123 AR" />
      </label>
      <label>
        Número de interno
        <input name="internalNumber" defaultValue={vehicle?.internalNumber ?? ""} placeholder="1910" />
      </label>
      <label>
        Titular
        <select name="owner" defaultValue={vehicle?.owner ?? ""}>
          <option value="">Sin definir</option>
          <option value="LA ARAUCANA VIAJES SRL">LA ARAUCANA VIAJES SRL</option>
          <option value="TROMPUL S.R.L.">TROMPUL S.R.L.</option>
          <option value="PRIETO, JUAN CARLOS">PRIETO, JUAN CARLOS</option>
        </select>
      </label>
      <label>
        Tipo de unidad
        <select name="kind" defaultValue={vehicle?.kind ?? "CAMIONETA"}>
          <option value="CAMIONETA">Camioneta</option>
          <option value="BUS">Bus</option>
          <option value="UTILITARIO">Utilitario (no se asigna a salidas)</option>
        </select>
      </label>
      <label>
        Año
        <input name="year" type="number" min="1980" max="2100" defaultValue={vehicle?.year ?? ""} placeholder="2019" />
      </label>
      <label>
        Fecha de adquisición
        <input name="acquiredAt" type="date" defaultValue={inputDate(vehicle?.acquiredAt)} />
      </label>
      <label>
        Vencimiento revisión técnica
        <input name="technicalInspectionDueAt" type="date" defaultValue={inputDate(vehicle?.technicalInspectionDueAt)} />
      </label>
      <label>
        Vencimiento RTO nacional
        <input name="rtoDueAt" type="date" defaultValue={inputDate(vehicle?.rtoDueAt)} />
      </label>
      <label>
        Aseguradora
        <input name="insurer" defaultValue={vehicle?.insurer ?? ""} placeholder="Federacion / Prot Mut" />
      </label>
      <label>
        Vencimiento de póliza
        <input name="policyDueAt" type="date" defaultValue={inputDate(vehicle?.policyDueAt)} />
      </label>
      <label className="checkbox-row">
        <input name="publicTransport" type="checkbox" defaultChecked={vehicle?.publicTransport ?? false} />
        Habilitada para transporte público (Prot Mut)
      </label>
      <label className="span-2">
        Notas de la unidad
        <input name="notes" defaultValue={vehicle?.notes ?? ""} placeholder="Vendida, fuera de servicio, observaciones…" />
      </label>
      <label>
        Capacidad
        <input readOnly value={selectedTemplate?.capacity ?? vehicle?.seats?.length ?? 0} aria-label="Capacidad calculada" />
      </label>
      <label className="checkbox-row">
        <input name="isActive" type="checkbox" defaultChecked={vehicle?.isActive ?? true} />
        Activa
      </label>
      <SeatLayoutEditor
        key={seatKey}
        initialSeats={selectedTemplate?.seats ?? vehicle?.seats ?? []}
        initialLayoutMarkers={selectedTemplate ? [] : layoutMarkers}
      />
      <FieldError id="seats-error" message={errors.seats} />
      <div className="form-actions span-2">
        <AdminSubmitButton>{submitLabel}</AdminSubmitButton>
        <Link className="ghost-button" href="/admin/naves">Cancelar</Link>
      </div>
    </form>
  );
}
