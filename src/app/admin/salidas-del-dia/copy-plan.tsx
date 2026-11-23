"use client";

import { useRef, useState } from "react";

export function CopyPlan({ message }: { message: string }) {
  const [status, setStatus] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  return <div className="handoff-copy">
    <textarea ref={field} readOnly aria-label="Mensaje para el chofer" value={message} rows={Math.min(7, message.split("\n").length + 1)} />
    <button type="button" className="ghost-button" onClick={async () => {
      try {
        await navigator.clipboard.writeText(message);
        setStatus("Mensaje copiado.");
      } catch {
        field.current?.focus();
        field.current?.select();
        setStatus("Texto seleccionado. Usá la opción Copiar.");
      }
    }}>Copiar jornada</button> <span role="status">{status}</span>
  </div>;
}
