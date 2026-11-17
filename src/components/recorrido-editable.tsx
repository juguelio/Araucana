"use client";

import Link from "next/link";
import { useState, useTransition, type DragEvent } from "react";
import { guardarRecorridoAction, moverANaveAction } from "@/app/admin/aeropuerto/orden-de-servicio/ver/actions";
import { CeldaDeLaOrden } from "./service-order-cells";

export type FilaDeLaOrden = { code: string; celdas: string[] };

type RecorridoEditableProps = {
  date: string;
  flightId: string;
  /** Nave de esta orden; `null` en un vuelo sin nave (o con una sola, sin asignación) y en «sin nave». */
  assignmentId: string | null;
  /** Se puede reordenar y soltar gente acá. La orden «sin nave» no: sólo se saca gente de ella. */
  editable: boolean;
  /** Las naves del vuelo, para pasar un pasajero de una a otra. Vacío si el vuelo tiene una sola. */
  naves: Array<{ assignmentId: string; name: string }>;
  columnas: readonly string[];
  filas: FilaDeLaOrden[];
};

/** El tipo del arrastre lleva el vuelo: sólo se puede soltar en una orden del mismo vuelo. */
const tipoDelVuelo = (flightId: string) => `application/x-araucana-recorrida-${flightId.toLowerCase()}`;

type Arrastre = { code: string; desde: string | null };

/**
 * Las filas de una orden de servicio del panel, ordenables a mano.
 *
 * - Arrastrar una fila la cambia de lugar; soltarla en otra orden del mismo vuelo la pasa a esa nave.
 * - Las flechas hacen lo mismo con teclado o en el celular, donde arrastrar no siempre anda.
 * - «Nave» pasa al pasajero al final de la recorrida de otra nave del vuelo.
 *
 * Cada cambio se guarda al toque (no hay botón «Guardar»): lo que el operador ve es lo que recibe el
 * chofer en el Excel y en su link.
 */
export function RecorridoEditable({ date, flightId, assignmentId, editable, naves, columnas, filas }: RecorridoEditableProps) {
  const firma = filas.map((fila) => fila.code).join("|");
  const [orden, setOrden] = useState(() => filas.map((fila) => fila.code));
  const [firmaVista, setFirmaVista] = useState(firma);
  // Cuando el servidor devuelve otra lista (alguien pasó un pasajero a esta nave), manda la del servidor.
  if (firma !== firmaVista) {
    setFirmaVista(firma);
    setOrden(filas.map((fila) => fila.code));
  }
  const [sobre, setSobre] = useState<number | null>(null);
  const [estado, setEstado] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const porCodigo = new Map(filas.map((fila) => [fila.code, fila]));
  const tipo = tipoDelVuelo(flightId);
  const columnasTotales = columnas.length + 1;

  function guardar(codes: string[]) {
    const anterior = orden;
    setOrden(codes.filter((code) => porCodigo.has(code)));
    setEstado(null);
    startTransition(async () => {
      const resultado = await guardarRecorridoAction({ date, flightId, assignmentId, codes });
      if (resultado.error) {
        setOrden(anterior);
        setEstado({ tipo: "error", texto: resultado.error });
      } else {
        setEstado({ tipo: "ok", texto: "Recorrida guardada." });
      }
    });
  }

  function mover(code: string, destino: number) {
    const sinEl = orden.filter((actual) => actual !== code);
    const lugar = Math.max(0, Math.min(destino, sinEl.length));
    const nuevo = [...sinEl.slice(0, lugar), code, ...sinEl.slice(lugar)];
    if (nuevo.join() !== orden.join()) guardar(nuevo);
  }

  function pasarANave(code: string, destino: string) {
    setEstado(null);
    startTransition(async () => {
      const resultado = await moverANaveAction({ date, flightId, assignmentId: destino, code });
      setEstado(resultado.error ? { tipo: "error", texto: resultado.error } : null);
    });
  }

  function alEmpezar(evento: DragEvent<HTMLTableRowElement>, code: string) {
    const arrastre: Arrastre = { code, desde: assignmentId };
    evento.dataTransfer.effectAllowed = "move";
    evento.dataTransfer.setData(tipo, JSON.stringify(arrastre));
    // Safari no arranca el arrastre sin un tipo de texto plano.
    evento.dataTransfer.setData("text/plain", code);
  }

  function alPasar(evento: DragEvent<HTMLElement>, indice: number) {
    if (!editable || !evento.dataTransfer.types.includes(tipo)) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    setSobre(indice);
  }

  function alSoltar(evento: DragEvent<HTMLElement>, indice: number) {
    setSobre(null);
    if (!editable) return;
    const dato = evento.dataTransfer.getData(tipo);
    if (!dato) return;
    evento.preventDefault();
    let arrastre: Arrastre;
    try {
      arrastre = JSON.parse(dato);
    } catch {
      return;
    }
    if (arrastre.desde === assignmentId && orden.includes(arrastre.code)) {
      const desde = orden.indexOf(arrastre.code);
      // Soltar debajo de sí misma corre el índice: la fila ya no está en la lista.
      mover(arrastre.code, desde < indice ? indice - 1 : indice);
      return;
    }
    const sinEl = orden.filter((actual) => actual !== arrastre.code);
    guardar([...sinEl.slice(0, indice), arrastre.code, ...sinEl.slice(indice)]);
  }

  const visibles = orden.filter((code) => porCodigo.has(code));

  return (
    <tbody
      className={`orden-recorrida${pendiente ? " orden-recorrida-guardando" : ""}`}
      onDragLeave={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) setSobre(null);
      }}
    >
      {visibles.length === 0 ? (
        <tr
          className={`orden-recorrida-vacia no-print${sobre === 0 ? " orden-recorrida-sobre" : ""}`}
          onDragOver={(evento) => alPasar(evento, 0)}
          onDrop={(evento) => alSoltar(evento, 0)}
        >
          <td colSpan={columnasTotales}>Sin pasajeros en esta nave. Arrastrá una fila de otra nave del vuelo hasta acá.</td>
        </tr>
      ) : null}
      {visibles.map((code, indice) => {
        const fila = porCodigo.get(code)!;
        return (
          <tr
            key={code}
            data-codigo={code}
            draggable
            className={sobre === indice ? "orden-recorrida-sobre" : sobre === visibles.length && indice === visibles.length - 1 ? "orden-recorrida-sobre-abajo" : undefined}
            onDragStart={(evento) => alEmpezar(evento, code)}
            onDragEnd={() => setSobre(null)}
            onDragOver={(evento) => {
              // La mitad de abajo de la última fila suelta al final.
              const caja = evento.currentTarget.getBoundingClientRect();
              const abajo = evento.clientY > caja.top + caja.height / 2;
              alPasar(evento, abajo && indice === visibles.length - 1 ? visibles.length : indice);
            }}
            onDrop={(evento) => {
              const caja = evento.currentTarget.getBoundingClientRect();
              const abajo = evento.clientY > caja.top + caja.height / 2;
              alSoltar(evento, abajo && indice === visibles.length - 1 ? visibles.length : indice);
            }}
          >
            {fila.celdas.map((celda, columna) => (
              <td key={`${code}-${columna}`} data-columna={columnas[columna]}>
                {columna === 0 ? (
                  <span className="orden-parada">
                    <span className="orden-arrastre no-print" aria-hidden="true">⠿</span>
                    <span className="orden-parada-numero">{indice + 1}.</span>{" "}
                    <CeldaDeLaOrden celda={celda} columna={columnas[columna]} />
                  </span>
                ) : (
                  <CeldaDeLaOrden celda={celda} columna={columnas[columna]} />
                )}
              </td>
            ))}
            <td className="orden-acciones no-print" data-columna="Acción">
              <span className="orden-recorrida-controles">
                {editable ? (
                  <>
                    <button
                      type="button"
                      className="orden-flecha"
                      onClick={() => mover(code, indice - 1)}
                      disabled={indice === 0 || pendiente}
                      aria-label={`Subir ${fila.celdas[0]}`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="orden-flecha"
                      onClick={() => mover(code, indice + 1)}
                      disabled={indice === visibles.length - 1 || pendiente}
                      aria-label={`Bajar ${fila.celdas[0]}`}
                    >
                      ↓
                    </button>
                  </>
                ) : null}
                {naves.length > 1 ? (
                  <select
                    className="orden-nave-select"
                    aria-label={`Nave de ${fila.celdas[0]}`}
                    value={assignmentId ?? ""}
                    disabled={pendiente}
                    onChange={(evento) => {
                      if (evento.target.value) pasarANave(code, evento.target.value);
                    }}
                  >
                    {assignmentId ? null : <option value="">Sin nave</option>}
                    {naves.map((nave) => (
                      <option key={nave.assignmentId} value={nave.assignmentId}>{nave.name}</option>
                    ))}
                  </select>
                ) : null}
                <Link href={`/admin/reservas/${code}/editar`}>Editar</Link>
              </span>
            </td>
          </tr>
        );
      })}
      {estado ? (
        <tr className="orden-recorrida-estado no-print">
          <td colSpan={columnasTotales}>
            <span className={estado.tipo === "error" ? "orden-recorrida-error" : "orden-recorrida-ok"} role={estado.tipo === "error" ? "alert" : "status"}>
              {estado.texto}
            </span>
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}
