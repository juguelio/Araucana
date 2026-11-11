"use client";

import { useEffect, useState } from "react";

type PlanillaLinkBoxProps = {
  token: string;
  title: string;
};

/**
 * Link público de la planilla. La URL se arma en el cliente porque el dominio real es el que está
 * sirviendo el panel (local, preview o producción), no una constante del build.
 */
export function PlanillaLinkBox({ token, title }: PlanillaLinkBoxProps) {
  const [url, setUrl] = useState(`/planilla/${token}`);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/planilla/${token}`);
  }, [token]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  const shareText = `${title}: completá tus datos para la planilla de salida en ${url}`;

  return (
    <div className="planilla-link-box">
      <span className="planilla-hint">Link para enviar a los pasajeros</span>
      <code>{url}</code>
      <div className="planilla-link-actions">
        <button type="button" className="ghost-button" onClick={copy}>
          {copied ? "Link copiado" : "Copiar link"}
        </button>
        <a
          className="ghost-button"
          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
          target="_blank"
          rel="noreferrer"
        >
          Compartir por WhatsApp
        </a>
        <a className="ghost-button" href={`/planilla/${token}`} target="_blank" rel="noreferrer">
          Ver como pasajero
        </a>
      </div>
    </div>
  );
}
