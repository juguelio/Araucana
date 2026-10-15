"use client";

import { useActionState, useEffect, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ManualBankDetails } from "@/lib/payments/manual-bank-details";
import { validateReceiptFile } from "@/lib/payments/receipt-validation";
import { uploadManualPaymentReceiptAction, type UploadReceiptState } from "./actions";

type ManualPaymentPanelProps = {
  reservationCode: string;
  bankDetails: ManualBankDetails | null;
  receiptUploadEnabled: boolean;
  existingReceipt?: {
    fileName: string | null;
    uploadedAt: Date | string | null;
  } | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? "Subiendo..." : "Subir comprobante"}
    </button>
  );
}

function formatUploadedAt(value: Date | string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Argentina/Salta"
  }).format(new Date(value));
}

export function ManualPaymentPanel({ reservationCode, existingReceipt, bankDetails: manualBankDetails, receiptUploadEnabled }: ManualPaymentPanelProps) {
  const router = useRouter();
  const [clientError, setClientError] = useState("");
  const initialState: UploadReceiptState = {
    ok: false,
    message: ""
  };
  const [state, formAction] = useActionState(uploadManualPaymentReceiptAction, initialState);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [router, state.ok]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    setClientError("");
    const formData = new FormData(event.currentTarget);
    const receipt = formData.get("receipt");

    if (!(receipt instanceof File)) {
      setClientError("Subi un comprobante valido.");
      event.preventDefault();
      return;
    }

    const validationError = validateReceiptFile(receipt);
    if (validationError) {
      setClientError(validationError);
      event.preventDefault();
    }
  }

  return (
    <section className="plain-card manual-payment-panel">
      <div>
        <p className="eyebrow">Pago manual</p>
        <h2 className="route-title">Transferencia bancaria</h2>
        <p className="muted">
          {manualBankDetails ? "Realizá la transferencia con estos datos y conservá el comprobante para su validación." : "Contactá al equipo de Araucana para coordinar el pago de tu reserva."}
        </p>
      </div>

      {manualBankDetails ? <dl className="bank-detail-grid">
        <div>
          <dt>Titular</dt>
          <dd>{manualBankDetails.holder}</dd>
        </div>
        <div>
          <dt>Banco</dt>
          <dd>{manualBankDetails.bank}</dd>
        </div>
        <div>
          <dt>Cuenta</dt>
          <dd>{manualBankDetails.accountType}</dd>
        </div>
        <div>
          <dt>CBU</dt>
          <dd>{manualBankDetails.cbu}</dd>
        </div>
        <div>
          <dt>Alias</dt>
          <dd>{manualBankDetails.alias}</dd>
        </div>
        <div>
          <dt>CUIT</dt>
          <dd>{manualBankDetails.cuit}</dd>
        </div>
      </dl> : <a href="/soporte">Coordinar el pago</a>}

      {existingReceipt?.fileName ? (
        <p className="success">
          Comprobante cargado: {existingReceipt.fileName}
          {existingReceipt.uploadedAt ? ` (${formatUploadedAt(existingReceipt.uploadedAt)})` : ""}
        </p>
      ) : null}

      {receiptUploadEnabled ? <form className="receipt-form" action={formAction} onSubmit={handleSubmit}>
        <input type="hidden" name="code" value={reservationCode} />
        <label>
          Comprobante
          <input
            name="receipt"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={() => setClientError("")}
            required
          />
        </label>
        {clientError || state.message ? (
          <p className={clientError || !state.ok ? "error" : "success"} role="status">
            {clientError || state.message}
          </p>
        ) : null}
        <SubmitButton />
      </form> : <p>La carga de comprobantes no está disponible. Contactá al equipo para enviarlo.</p>}
    </section>
  );
}
