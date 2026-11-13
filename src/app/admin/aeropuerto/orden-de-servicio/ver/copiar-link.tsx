"use client";

import { useState } from "react";

/**
 * Muestra el link firmado de la orden y lo copia al portapapeles para mandárselo al chofer por
 * WhatsApp. Si el navegador no deja usar el portapapeles (o el panel corre sin HTTPS), el link queda
 * seleccionable: no se pierde la función, sólo el atajo.
 */
export function CopiarLink({ url }: { url: string }) {
  const [copiado, setCopiado] = useState<"no" | "si" | "error">("no");

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado("si");
    } catch {
      setCopiado("error");
    }
  }

  return (
    <div className="orden-link-chofer no-print">
      <div>
        <span className="orden-link-rotulo">Link para el chofer</span>
        <code className="orden-link-url">{url}</code>
        <span className="orden-link-ayuda">
          Se abre sin usuario y vence al día siguiente del servicio. Mandáselo por WhatsApp.
        </span>
      </div>
      <button className="ghost-button" type="button" onClick={copiar}>
        {copiado === "si" ? "Copiado" : copiado === "error" ? "Copiá el link" : "Copiar link"}
      </button>
    </div>
  );
}
