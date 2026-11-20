"use client";

import { useState } from "react";

/**
 * Copia al portapapeles el link del voucher (#243). Dice «Copiar voucher», no «Copiar link»: el
 * admin no copia una dirección, copia el voucher. El admin lo necesita cuando el pasajero no dejó
 * teléfono: se lo pasa por donde pueda, sin tener que abrir el voucher y copiar la barra de
 * direcciones. Si el navegador no permite el portapapeles, cae a un textarea temporal para que el
 * botón nunca quede muerto.
 */
async function copiar(texto: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return;
    }
  } catch {
    // El navegador tiene portapapeles pero lo niega (permisos, contexto raro): cae al textarea.
  }

  const area = document.createElement("textarea");
  area.value = texto;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

export function CopiarVoucher({ url }: { url: string }) {
  const [estado, setEstado] = useState<"no" | "si" | "error">("no");

  return (
    <button
      type="button"
      className="ghost-button"
      title="Copia el link del voucher para mandárselo al pasajero"
      onClick={async () => {
        try {
          await copiar(url);
          setEstado("si");
          setTimeout(() => setEstado("no"), 2000);
        } catch {
          setEstado("error");
        }
      }}
    >
      {estado === "si" ? "¡Voucher copiado!" : estado === "error" ? "No se pudo copiar" : "Copiar voucher"}
    </button>
  );
}
