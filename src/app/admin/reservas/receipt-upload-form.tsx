"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { receiptAccept, receiptFormatsHelp } from "@/lib/payments/receipt-validation";
import { uploadReceiptFromAdminAction, type AdminReceiptState } from "./receipt-actions";

const inicial: AdminReceiptState = { ok: false, message: "" };

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? "Subiendo…" : "Subir comprobante"}
    </button>
  );
}

/** Formulario del modal «Comprobante»: el error o la confirmación quedan dentro del modal. */
export function ReceiptUploadForm({ code, replace }: { code: string; replace: boolean }) {
  const [state, action] = useActionState(uploadReceiptFromAdminAction, inicial);
  return (
    <form className="reservas-modal-form" action={action}>
      <input type="hidden" name="code" value={code} />
      <label>
        {replace ? "Reemplazar comprobante" : "Archivo del comprobante"}
        <input name="receipt" type="file" accept={receiptAccept} required />
      </label>
      <small className="muted">{receiptFormatsHelp}</small>
      {state.message ? (
        <p className={state.ok ? "reservas-modal-ok" : "error"} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      ) : null}
      <Enviar />
    </form>
  );
}
