"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import {
  ESTADOS_DE_ITEM, ESTADO_DE_ITEM_LABEL, ITEMS_DE_SERVICE, MAX_NOTA_DE_FALLA, SECCIONES_DE_SERVICE, type EstadoDeItem
} from "@/lib/vehicles/service-sheet";
import { AdminFormAlert, AdminSubmitButton, FieldError } from "../../form-ui";
import { initialAdminFormState, type AdminFormState } from "../../form-state";

type FormAction = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

/** Lo último que se cargó de la nave, para comparar mientras se llena la planilla nueva. */
export type UltimoService = { fecha: string; fechaLabel: string; km: number; fallas: Record<string, string | true> } | null;

const ICONO: Record<EstadoDeItem, string> = { OK: "✓", FALLA: "✕", NA: "–" };

function hoyEnArgentina() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Salta" }).format(new Date());
}

const kmTexto = (km: number) => `${km.toLocaleString("es-AR")} km`;

/**
 * La planilla de service como tarjeta: los mismos 10 bloques y 50 ítems de la planilla de papel, pero
 * cada ítem se marca con un toque (Bien · Falla · No aplica) y los bloques se dan por buenos de una vez.
 * Todo es controlado: si el guardado vuelve con un error, no se pierde lo marcado.
 */
export function ServiceCardForm({ action, vehicleId, nave, ultimo, imprimirHref }: {
  action: FormAction; vehicleId: string; nave: string; ultimo: UltimoService; imprimirHref: string;
}) {
  const [state, formAction] = useActionState(action, initialAdminFormState);
  const errors = state.fieldErrors;
  const [fecha, setFecha] = useState(hoyEnArgentina);
  const [km, setKm] = useState("");
  // El error del servidor sobre el kilometraje vale para el número que se mandó; si se corrige, se va.
  const [kmEnviado, setKmEnviado] = useState("");
  const errorKm = errors.odometerKm && km === kmEnviado ? errors.odometerKm : undefined;
  const [estados, setEstados] = useState<Record<string, EstadoDeItem>>({});
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [hecho, setHecho] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const kmNumero = /^\d+$/.test(km.replace(/[.\s]/g, "")) ? Number(km.replace(/[.\s]/g, "")) : null;
  const recorridos = kmNumero !== null && ultimo ? kmNumero - ultimo.km : null;
  const conteo = useMemo(() => {
    const valores = Object.values(estados);
    return { revisados: valores.length, fallas: valores.filter((e) => e === "FALLA").length, total: ITEMS_DE_SERVICE.length };
  }, [estados]);
  const faltan = conteo.total - conteo.revisados;

  const marcar = (id: string, estado: EstadoDeItem | null) => setEstados((actual) => {
    const nuevo = { ...actual };
    if (estado) nuevo[id] = estado; else delete nuevo[id];
    return nuevo;
  });
  /** «Todo bien» de un bloque (o de toda la planilla): marca Bien sólo lo que todavía no tiene estado. */
  const todoBien = (ids: string[]) => setEstados((actual) => {
    const nuevo = { ...actual };
    for (const id of ids) if (!nuevo[id]) nuevo[id] = "OK";
    return nuevo;
  });

  return (
    <form className="svc-form" action={formAction} onSubmit={() => setKmEnviado(km)}>
      <AdminFormAlert state={state} />
      <input type="hidden" name="vehicleId" value={vehicleId} />

      <div className="svc-cabecera">
        <div className="svc-cabecera-nave">
          <span className="svc-etiqueta">Planilla de service</span>
          <strong>{nave}</strong>
        </div>
        <label className="svc-campo">
          <span className="svc-etiqueta">Fecha</span>
          <input name="servicedAt" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required
            aria-invalid={Boolean(errors.servicedAt)} aria-describedby={errors.servicedAt ? "svc-fecha-error" : undefined} />
          <FieldError id="svc-fecha-error" message={errors.servicedAt} />
        </label>
        <label className="svc-campo svc-campo-km">
          <span className="svc-etiqueta">Kilometraje</span>
          <input name="odometerKm" inputMode="numeric" autoComplete="off" value={km} onChange={(e) => setKm(e.target.value)}
            placeholder={ultimo ? ultimo.km.toLocaleString("es-AR") : "148.320"} required
            aria-invalid={Boolean(errorKm) || (recorridos !== null && recorridos < 0)}
            aria-describedby="svc-km-ayuda" />
          <span id="svc-km-ayuda" className="svc-ayuda" data-alerta={errorKm || (recorridos !== null && recorridos < 0) ? "true" : undefined}>
            {errorKm ? errorKm
              : !ultimo ? "Primer service cargado de esta nave."
              : recorridos === null ? `Último: ${kmTexto(ultimo.km)} el ${ultimo.fechaLabel}.`
              : recorridos < 0 ? `Es menos que el último (${kmTexto(ultimo.km)}). Revisá el número.`
              : `+${kmTexto(recorridos)} desde el ${ultimo.fechaLabel}.`}
          </span>
        </label>
      </div>

      <div className="svc-herramientas">
        <p className="muted">Tocá el estado de cada ítem. Lo que quede sin marcar no se cuenta como revisado.</p>
        <div className="inline-actions">
          <button type="button" className="ghost-button" onClick={() => todoBien(ITEMS_DE_SERVICE.map((i) => i.id))} disabled={faltan === 0}>
            Marcar lo que falta como Bien
          </button>
          <Link className="ghost-button" href={imprimirHref} target="_blank">Imprimir planilla en blanco</Link>
        </div>
      </div>

      <div className="svc-bloques">
        {SECCIONES_DE_SERVICE.map((seccion) => {
          const ids = seccion.items.map((i) => i.id);
          const marcados = ids.filter((id) => estados[id]).length;
          const fallasBloque = ids.filter((id) => estados[id] === "FALLA").length;
          return (
            <fieldset className="svc-bloque" key={seccion.id} data-completo={marcados === ids.length || undefined} data-falla={fallasBloque > 0 || undefined}>
              <legend className="svc-bloque-titulo">
                <span>{seccion.label}</span>
                <small>{marcados}/{ids.length}{fallasBloque ? ` · ${fallasBloque} falla${fallasBloque === 1 ? "" : "s"}` : ""}</small>
              </legend>
              <button type="button" className="svc-todo-bien" onClick={() => todoBien(ids)} disabled={marcados === ids.length}>Todo bien</button>
              <ul className="svc-items">
                {seccion.items.map((item) => {
                  const estado = estados[item.id];
                  const anterior = ultimo?.fallas[item.id];
                  return (
                    <li key={item.id} className="svc-item" data-estado={estado ?? "vacio"}>
                      <div className="svc-item-fila">
                        <span className="svc-item-nombre">
                          {item.label}
                          {anterior ? <small className="svc-antes" title={typeof anterior === "string" ? anterior : undefined}>falló el {ultimo?.fechaLabel}{typeof anterior === "string" ? `: ${anterior}` : ""}</small> : null}
                        </span>
                        <span className="svc-opciones" role="radiogroup" aria-label={`${seccion.label}: ${item.label}`}>
                          {ESTADOS_DE_ITEM.map((opcion) => (
                            <label key={opcion} className="svc-opcion" data-opcion={opcion}>
                              <input type="radio" name={`check:${item.id}`} value={opcion} checked={estado === opcion}
                                onChange={() => marcar(item.id, opcion)}
                                onClick={() => { if (estado === opcion) marcar(item.id, null); }} />
                              <span aria-hidden="true">{ICONO[opcion]}</span>
                              <span className="svc-opcion-texto">{ESTADO_DE_ITEM_LABEL[opcion]}</span>
                            </label>
                          ))}
                        </span>
                      </div>
                      {estado === "FALLA" ? (
                        <input className="svc-nota" name={`nota:${item.id}`} maxLength={MAX_NOTA_DE_FALLA} value={notas[item.id] ?? ""}
                          onChange={(e) => setNotas((n) => ({ ...n, [item.id]: e.target.value }))}
                          placeholder="¿Qué tiene? (opcional)" aria-label={`Qué tiene: ${item.label}`} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>

      <div className="svc-textos">
        <label>
          Qué se le hizo
          <textarea name="workDone" rows={3} maxLength={500} value={hecho} onChange={(e) => setHecho(e.target.value)}
            placeholder="Ej: cambio de aceite y filtros, pastillas delanteras, alineación" />
        </label>
        <label>
          Observaciones
          <textarea name="notes" rows={3} maxLength={500} value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Lo que tenga que saber el próximo que la agarre" />
        </label>
      </div>

      <div className="svc-barra">
        <div className="svc-progreso" aria-live="polite">
          <span className="svc-progreso-barra" aria-hidden="true">
            <span style={{ width: `${(conteo.revisados / conteo.total) * 100}%` }} />
          </span>
          <span><strong>{conteo.revisados}</strong> de {conteo.total} revisados</span>
          {conteo.fallas ? <span className="svc-progreso-fallas">{conteo.fallas} falla{conteo.fallas === 1 ? "" : "s"}</span> : null}
          {faltan && conteo.revisados ? <span className="muted">{faltan} sin revisar</span> : null}
        </div>
        <AdminSubmitButton>Guardar planilla</AdminSubmitButton>
      </div>
    </form>
  );
}
