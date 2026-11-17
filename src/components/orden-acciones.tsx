"use client";

import { useState, useTransition } from "react";
import { restablecerRecorridoAction } from "@/app/admin/aeropuerto/orden-de-servicio/ver/actions";

type OrdenAccionesProps = {
  /** `id` del `<section>` de la orden: es lo único que se imprime. */
  ordenId: string;
  excelHref: string | null;
  link: string | null;
  /** Para volver al orden sugerido; sólo cuando la orden tiene algo ordenado a mano. */
  restablecer?: { date: string; flightId: string; codes: string[] } | null;
};

/**
 * Imprimir, descargar y copiar el link de **una** orden de servicio (un vuelo, o una nave del vuelo).
 *
 * Imprimir marca la orden y el CSS de impresión esconde las demás. La marca se saca en `afterprint`
 * —Safari vuelve de `print()` antes de cerrar el diálogo—; si el evento no llegara, la marca sólo
 * afecta al papel y la próxima impresión la reemplaza.
 */
export function OrdenAcciones({ ordenId, excelHref, link, restablecer }: OrdenAccionesProps) {
  const [copiado, setCopiado] = useState<"no" | "si" | "error">("no");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function imprimir() {
    const raiz = document.documentElement;
    document.querySelectorAll("[data-imprimir]").forEach((nodo) => nodo.removeAttribute("data-imprimir"));
    document.getElementById(ordenId)?.setAttribute("data-imprimir", "");
    raiz.setAttribute("data-imprimir-una", "");
    const limpiar = () => {
      raiz.removeAttribute("data-imprimir-una");
      document.getElementById(ordenId)?.removeAttribute("data-imprimir");
    };
    window.addEventListener("afterprint", limpiar, { once: true });
    window.print();
  }

  async function copiar() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado("si");
    } catch {
      setCopiado("error");
      window.prompt("Copiá el link para el chofer", link);
    }
  }

  function volverAlSugerido() {
    if (!restablecer) return;
    startTransition(async () => {
      const resultado = await restablecerRecorridoAction(restablecer);
      setMensaje(resultado.error ?? null);
    });
  }

  return (
    <div className="orden-bloque-acciones no-print">
      <button className="ghost-button" type="button" onClick={imprimir}>Imprimir</button>
      {excelHref ? <a className="ghost-button" href={excelHref}>Descargar Excel</a> : null}
      {link ? (
        <button className="ghost-button" type="button" onClick={copiar} title="Se abre sin usuario y vence al día siguiente del servicio.">
          {copiado === "si" ? "Link copiado" : copiado === "error" ? "Copiá el link" : "Copiar link"}
        </button>
      ) : null}
      {restablecer ? (
        <button className="ghost-button" type="button" onClick={volverAlSugerido} disabled={pendiente}>
          {pendiente ? "Restableciendo…" : "Orden sugerido"}
        </button>
      ) : null}
      {mensaje ? <span className="orden-recorrida-error" role="alert">{mensaje}</span> : null}
    </div>
  );
}
