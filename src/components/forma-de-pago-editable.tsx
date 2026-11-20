"use client";

import { useState, useTransition } from "react";
import { guardarFormaDePagoAction } from "@/app/admin/aeropuerto/orden-de-servicio/ver/payment-method-actions";
import { FormaDePagoOrden } from "./forma-de-pago-orden";

export function FormaDePagoEditable({ date, code, nombre, metodo }: { date: string; code: string; nombre: string; metodo: string }) {
  const [pendiente, startTransition] = useTransition();
  const [estado, setEstado] = useState<{ error?: string; ok?: string } | null>(null);
  const normalizado = metodo.trim().toLowerCase();
  const valor = normalizado === "efectivo" ? "Efectivo" : normalizado === "transferencia" ? "Transferencia" : metodo;
  return (
    <>
      <span className="orden-forma-pago-editor no-print">
        <select
          aria-label={`Forma de pago de ${nombre}`}
          value={valor}
          disabled={pendiente}
          onChange={(evento) => {
            const method = evento.target.value as "" | "Efectivo" | "Transferencia";
            setEstado(null);
            startTransition(async () => {
              setEstado(await guardarFormaDePagoAction({ date, code, method }));
            });
          }}
        >
          <option value="">Sin indicar</option>
          <option value="Efectivo">Efectivo</option>
          <option value="Transferencia">Transferencia</option>
          {valor && valor !== "Efectivo" && valor !== "Transferencia" ? <option value={valor}>{valor}</option> : null}
        </select>
        {pendiente ? <small role="status">Guardando…</small>
          : estado ? <small role={estado.error ? "alert" : "status"}>{estado.error ?? estado.ok}</small> : null}
      </span>
      <span className="orden-forma-pago-impresa"><FormaDePagoOrden metodo={metodo} /></span>
    </>
  );
}
