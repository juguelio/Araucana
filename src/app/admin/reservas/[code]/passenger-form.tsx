"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AdminFormAlert, AdminSubmitButton, FieldError } from "../../form-ui";
import { initialAdminFormState, type AdminFormState } from "../../form-state";

type PassengerFormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

type PassengerFormData = {
  code: string;
  passenger: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    documentType: string;
    documentId: string;
    nationality?: string | null;
  };
};

type PassengerFormProps = {
  action: PassengerFormAction;
  reservation: PassengerFormData;
};

export function PassengerForm({ action, reservation }: PassengerFormProps) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const errors = state.fieldErrors;

  return (
    <form className="admin-form-grid" action={formAction}>
      <AdminFormAlert state={state} />
      <input type="hidden" name="code" value={reservation.code} />
      <label>
        Nombre
        <input
          name="firstName"
          defaultValue={reservation.passenger.firstName}
          required
          aria-invalid={Boolean(errors.firstName)}
          aria-describedby={errors.firstName ? "firstName-error" : undefined}
        />
        <FieldError id="firstName-error" message={errors.firstName} />
      </label>
      <label>
        Apellido
        <input
          name="lastName"
          defaultValue={reservation.passenger.lastName}
          required
          aria-invalid={Boolean(errors.lastName)}
          aria-describedby={errors.lastName ? "lastName-error" : undefined}
        />
        <FieldError id="lastName-error" message={errors.lastName} />
      </label>
      <label>
        Email (opcional)
        <input
          name="email"
          type="email"
          defaultValue={reservation.passenger.email}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "email-error" : undefined}
        />
        <FieldError id="email-error" message={errors.email} />
      </label>
      <label>
        Telefono
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={reservation.passenger.phone}
          required
          aria-invalid={Boolean(errors.phone)}
          aria-describedby={errors.phone ? "phone-error" : undefined}
        />
        <FieldError id="phone-error" message={errors.phone} />
      </label>
      <label>
        Tipo documento
        <input
          name="documentType"
          defaultValue={reservation.passenger.documentType}
          required
          aria-invalid={Boolean(errors.documentType)}
          aria-describedby={errors.documentType ? "documentType-error" : undefined}
        />
        <FieldError id="documentType-error" message={errors.documentType} />
      </label>
      <label>
        Numero documento
        <input
          name="documentId"
          defaultValue={reservation.passenger.documentId}
          aria-invalid={Boolean(errors.documentId)}
          aria-describedby={errors.documentId ? "documentId-error" : undefined}
        />
        <FieldError id="documentId-error" message={errors.documentId} />
      </label>
      <label className="span-2">
        Nacionalidad
        <input
          name="nationality"
          defaultValue={reservation.passenger.nationality ?? ""}
          aria-invalid={Boolean(errors.nationality)}
          aria-describedby={errors.nationality ? "nationality-error" : undefined}
        />
        <FieldError id="nationality-error" message={errors.nationality} />
      </label>
      <div className="form-actions span-2">
        <AdminSubmitButton>Guardar cambios</AdminSubmitButton>
        <Link className="ghost-button" href="/admin/reservas">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
