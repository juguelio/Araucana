"use client";

import { useMemo, useState } from "react";
import type { SalidaOption } from "./salida-picker-utils";
import type { ClaveTramo, TramoDelViaje } from "./viaje-search-bar";
import { destinosDesde, origenes as listarOrigenes, primerDia, rutaEntre, salidasDelTramo, vueltasPosibles, viajeInicial, type RutaDelPanel } from "./viaje-utils";

export function useViaje(schedules: SalidaOption[], rutas: RutaDelPanel[], inicio: { origen: string; destino: string } | null,
  pedido: { ida?: SalidaOption; vuelta?: SalidaOption; dia?: string; conVuelta?: boolean } = {}) {
  // El viaje.
  const inicial = useMemo(() => viajeInicial(schedules, inicio), [schedules, inicio]);
  const [origen, setOrigen] = useState(inicial.origen);
  const [destino, setDestino] = useState(inicial.destino);
  const [ida, setIda] = useState(() => ({ dia: pedido.ida?.dayKey ?? pedido.dia ?? inicial.dia, salidaId: pedido.ida?.id ?? "" }));
  const [vuelta, setVuelta] = useState(() => ({
    activa: Boolean(pedido.conVuelta), dia: pedido.vuelta?.dayKey ?? primerDia(vueltasPosibles(schedules, inicial.origen, inicial.destino, pedido.ida), ida.dia),
    salidaId: pedido.vuelta?.id ?? ""
  }));
  const [paradaIda, setParadaIda] = useState("");
  const [paradaVuelta, setParadaVuelta] = useState("");
  const origenes = useMemo(() => listarOrigenes(schedules, rutas), [schedules, rutas]);
  const destinos = useMemo(() => destinosDesde(schedules, origen, rutas), [schedules, origen, rutas]);
  const salidasIda = useMemo(() => salidasDelTramo(schedules, origen, destino), [schedules, origen, destino]);
  const inversa = useMemo(() => salidasDelTramo(schedules, destino, origen), [schedules, origen, destino]);
  const salidaIda = salidasIda.find((salida) => salida.id === ida.salidaId) ?? null;
  const salidasVuelta = useMemo(() => vueltasPosibles(schedules, origen, destino, salidaIda), [schedules, origen, destino, salidaIda]);
  const salidaVuelta = vuelta.activa ? salidasVuelta.find((salida) => salida.id === vuelta.salidaId) ?? null : null;
  const viajeListo = Boolean(salidaIda && (!vuelta.activa || salidaVuelta));
  const moneda = salidaIda?.currency ?? salidasIda[0]?.currency ?? "ARS";

  /** Otro origen o destino: las salidas elegidas ya no sirven; el día se queda si tiene salidas. */
  function cambiarRuta(nuevoOrigen: string, nuevoDestino: string) {
    const tramo = salidasDelTramo(schedules, nuevoOrigen, nuevoDestino);
    const dia = tramo.some((salida) => salida.dayKey === ida.dia) ? ida.dia : primerDia(tramo);
    const hayVuelta = salidasDelTramo(schedules, nuevoDestino, nuevoOrigen).length > 0;
    setOrigen(nuevoOrigen);
    setDestino(nuevoDestino);
    setIda({ dia, salidaId: "" });
    setVuelta((actual) => ({
      activa: actual.activa && hayVuelta,
      dia: primerDia(vueltasPosibles(schedules, nuevoOrigen, nuevoDestino), dia),
      salidaId: ""
    }));
    setParadaIda("");
    setParadaVuelta("");
  }

  function elegirLugar(campoLugar: "desde" | "hacia", nombre: string) {
    if (campoLugar === "desde") {
      const posibles = destinosDesde(schedules, nombre, rutas);
      cambiarRuta(nombre, posibles.some((lugar) => lugar.nombre === destino) ? destino : posibles[0]?.nombre ?? "");
    } else {
      cambiarRuta(origen, nombre);
    }
  }

  function elegirDia(tramo: ClaveTramo, dia: string) {
    if (tramo === "ida") setIda({ dia, salidaId: "" });
    else setVuelta((actual) => ({ ...actual, dia, salidaId: "" }));
  }

  function elegirSalida(tramo: ClaveTramo, id: string) {
    if (tramo === "vuelta") {
      setVuelta((actual) => ({ ...actual, salidaId: id }));
      setParadaVuelta("");
      return;
    }
    const nueva = salidasIda.find((salida) => salida.id === id);
    setIda((actual) => ({ ...actual, salidaId: id }));
    setParadaIda("");
    if (!nueva) return;
    // Si la vuelta elegida quedó antes que la nueva ida, se suelta; el día de la vuelta nunca queda
    // antes que el de la ida.
    const posibles = vueltasPosibles(schedules, origen, destino, nueva);
    setVuelta((actual) => {
      const sigue = posibles.some((salida) => salida.id === actual.salidaId);
      const dia = actual.dia && actual.dia >= nueva.dayKey && posibles.some((salida) => salida.dayKey === actual.dia)
        ? actual.dia
        : primerDia(posibles, nueva.dayKey);
      return { ...actual, dia, salidaId: sigue ? actual.salidaId : "" };
    });
  }

  function agregarVuelta() {
    setVuelta({ activa: true, dia: primerDia(salidasVuelta, salidaIda?.dayKey ?? ida.dia), salidaId: "" });
  }

  function quitarVuelta() {
    setVuelta({ activa: false, dia: "", salidaId: "" });
    setParadaVuelta("");
  }

  const tramos: TramoDelViaje[] = [
    { clave: "ida", desde: origen, hacia: destino, dia: ida.dia, minimo: "", salidas: salidasIda, elegida: ida.salidaId },
    ...(vuelta.activa
      ? [{ clave: "vuelta" as const, desde: destino, hacia: origen, dia: vuelta.dia, minimo: salidaIda?.dayKey ?? ida.dia, salidas: salidasVuelta, elegida: vuelta.salidaId }]
      : [])
  ];
  const precioVuelta = salidasVuelta[0]?.priceCents;
  const ofrecerVuelta = !vuelta.activa && salidasVuelta.length > 0
    ? { detalle: precioVuelta ? `${destino} → ${origen} · ${new Intl.NumberFormat("es-AR", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(precioVuelta / 100)} más por persona` : `${destino} → ${origen}` }
    : null;

  const barra = {
    origenes, destinos, origen, destino, tramos, ofrecerVuelta,
    puedeInvertir: inversa.length > 0 || Boolean(rutaEntre(rutas, destino, origen)),
    onLugar: elegirLugar, onInvertir: () => cambiarRuta(destino, origen), onDia: elegirDia,
    onSalida: elegirSalida, onAgregarVuelta: agregarVuelta, onQuitarVuelta: quitarVuelta
  };
  return { barra, origen, destino, salidaIda, salidaVuelta, vuelta, viajeListo, moneda, paradaIda, paradaVuelta,
    setParadaIda, setParadaVuelta, rutaSinSalidas: !salidasIda.length ? rutaEntre(rutas, origen, destino) : null };
}
