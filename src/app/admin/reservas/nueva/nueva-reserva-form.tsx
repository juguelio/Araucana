"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useActionState, useState } from "react";
import { createAdminReservationAction } from "../actions";
import { FieldError } from "../../form-ui";
import { initialAdminFormState } from "../../form-state";
import type { SalidaOption } from "./salida-picker-utils";
import { ViajeSearchBar, diaCorto, type ClaveTramo, type TramoDelViaje } from "./viaje-search-bar";
import {
  destinosDesde, origenes as listarOrigenes, precioDelTramo, primerDia, salidasDelTramo, totalDelViaje, vueltasPosibles, viajeInicial
} from "./viaje-utils";
import "./salida-picker.css";
import "./alta-template.css";

export type { SalidaOption } from "./salida-picker-utils";

/**
 * Alta manual de reserva con el template del aeropuerto (pedido de Jugue, 18-nov: «adaptá esta página
 * al nuevo template»):
 * - arriba, el recuadro del viaje: Desde ⇄ Hacia y dos fechas (la ida, y la vuelta para agregar);
 * - con las salidas elegidas aparecen solos «Dónde baja» (si la ruta tiene paradas), los pasajeros y
 *   los datos del titular, sin «Continuar»;
 * - al costado, el resumen con el total y un botón que dice qué falta.
 *
 * Con vuelta se crean las dos reservas juntas (mismo pasajero, mismo viaje). Los errores vuelven del
 * server action con el nombre del campo que falló y cada uno se marca en su lugar (#242). Los campos
 * son controlados para que un error no borre lo que ya se cargó.
 */
const VACIOS = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  documentType: "DNI",
  documentId: "",
  nationality: "",
  customPrice: "",
  referredBy: ""
};

type Draft = typeof VACIOS;

function formatPrice(cents: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function NuevaReservaForm({ schedules }: { schedules: SalidaOption[] }) {
  const [state, formAction, pending] = useActionState(createAdminReservationAction, initialAdminFormState);
  const [draft, setDraft] = useState<Draft>(VACIOS);
  const formRef = useRef<HTMLFormElement>(null);
  const errores = state.status === "error" ? state.fieldErrors : {};
  const cantidadErrores = Object.keys(errores).length;

  // El viaje.
  const inicial = useMemo(() => viajeInicial(schedules), [schedules]);
  const [origen, setOrigen] = useState(inicial.origen);
  const [destino, setDestino] = useState(inicial.destino);
  const [ida, setIda] = useState({ dia: inicial.dia, salidaId: "" });
  const [vuelta, setVuelta] = useState({ activa: false, dia: "", salidaId: "" });
  const [paradaIda, setParadaIda] = useState("");
  const [paradaVuelta, setParadaVuelta] = useState("");
  // Los pasajeros.
  const [lugares, setLugares] = useState(1);
  const [media, setMedia] = useState(0);
  const [sinCargo, setSinCargo] = useState(0);

  const origenes = useMemo(() => listarOrigenes(schedules), [schedules]);
  const destinos = useMemo(() => destinosDesde(schedules, origen), [schedules, origen]);
  const salidasIda = useMemo(() => salidasDelTramo(schedules, origen, destino), [schedules, origen, destino]);
  const inversa = useMemo(() => salidasDelTramo(schedules, destino, origen), [schedules, origen, destino]);
  const salidaIda = salidasIda.find((salida) => salida.id === ida.salidaId) ?? null;
  const salidasVuelta = useMemo(() => vueltasPosibles(schedules, origen, destino, salidaIda), [schedules, origen, destino, salidaIda]);
  const salidaVuelta = vuelta.activa ? salidasVuelta.find((salida) => salida.id === vuelta.salidaId) ?? null : null;
  const viajeListo = Boolean(salidaIda && (!vuelta.activa || salidaVuelta));
  const moneda = salidaIda?.currency ?? salidasIda[0]?.currency ?? "ARS";

  // Lugares: nunca más que los libres de las salidas elegidas.
  const maxLugares = Math.max(1, Math.min(salidaIda?.availableSeats ?? 24, salidaVuelta?.availableSeats ?? 24));
  useEffect(() => {
    if (lugares <= maxLugares) return;
    setLugares(maxLugares);
    setMedia((valor) => Math.min(valor, Math.max(maxLugares - 1, 0)));
    setSinCargo(0);
  }, [lugares, maxLugares]);

  const tramosDelPrecio = [
    ...(salidaIda ? [{ salida: salidaIda, parada: paradaIda }] : []),
    ...(salidaVuelta ? [{ salida: salidaVuelta, parada: paradaVuelta }] : [])
  ];
  const total = totalDelViaje(tramosDelPrecio, { lugares, media, sinCargo });
  const precioAjustado = draft.customPrice.trim() !== "";

  const campo = (name: keyof Draft) => ({
    name,
    value: draft[name],
    "aria-invalid": Boolean(errores[name]),
    "aria-describedby": errores[name] ? `error-${name}` : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((prev) => ({ ...prev, [name]: event.target.value }))
  });

  useEffect(() => {
    if (!cantidadErrores) return;
    const primero = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!primero) return;
    primero.focus();
    primero.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state, cantidadErrores]);

  // Con el viaje listo aparecen las secciones de abajo: la barra queda arriba y ellas justo debajo
  // (como en el aeropuerto: no se pierde de vista lo que se eligió).
  const listoAntes = useRef(viajeListo);
  useEffect(() => {
    if (viajeListo && !listoAntes.current) {
      const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      formRef.current?.querySelector<HTMLElement>(".trip-search")?.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
    }
    listoAntes.current = viajeListo;
  }, [viajeListo]);

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
      const posibles = destinosDesde(schedules, nombre);
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
  const precioVuelta = inversa[0]?.priceCents;
  const ofrecerVuelta = !vuelta.activa && inversa.length > 0
    ? { detalle: precioVuelta ? `${destino} → ${origen} · ${formatPrice(precioVuelta, moneda)} más por persona` : `${destino} → ${origen}` }
    : null;

  const datosListos = Boolean(draft.firstName.trim() && draft.lastName.trim() && draft.documentId.trim());
  const etapas = [
    { titulo: "El viaje", hecha: viajeListo },
    { titulo: "Pasajeros", hecha: viajeListo },
    { titulo: "Datos del titular", hecha: viajeListo && datosListos }
  ];
  const activa = etapas.findIndex((etapa) => !etapa.hecha);

  /** El botón del resumen dice qué falta; si falta una salida, abre ese casillero de la barra. */
  function abrirCasillero(clave: ClaveTramo) {
    const boton = formRef.current?.querySelector<HTMLButtonElement>(`[data-campo="${clave}"]`);
    boton?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (boton?.getAttribute("aria-expanded") !== "true") boton?.click();
  }

  const conParadas = [
    salidaIda?.stopFares?.length ? { clave: "ida" as const, salida: salidaIda, parada: paradaIda, cambiar: setParadaIda } : null,
    salidaVuelta?.stopFares?.length ? { clave: "vuelta" as const, salida: salidaVuelta, parada: paradaVuelta, cambiar: setParadaVuelta } : null
  ].filter((tramo) => tramo !== null);

  return (
    <form className="checkout-layout alta-template" action={formAction} ref={formRef} noValidate>
      <div className="checkout-main">
        <section className="form-panel checkout-panel">
          <ol className="wizard-steps checkout-progress" aria-label="Pasos de la reserva">
            {etapas.map((etapa, i) => (
              <li key={etapa.titulo} data-active={activa === i} data-done={etapa.hecha} aria-current={activa === i ? "step" : undefined}>
                <span>{etapa.hecha ? "✓" : i + 1}</span>
                {etapa.titulo}
              </li>
            ))}
          </ol>

          {state.message && (
            <div className="form-alert error" role="alert" id="alta-resumen">
              <p>{state.message}</p>
              {cantidadErrores > 1 && (
                <ul>
                  {Object.entries(errores).map(([name, mensaje]) => (
                    <li key={name}>
                      <a href={`#campo-${name}`} onClick={(event) => {
                        event.preventDefault();
                        formRef.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
                      }}>{mensaje}</a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="alta-viaje-head">
            <p className="eyebrow">El viaje</p>
            <h2 className="route-title">{vuelta.activa ? "Ida y vuelta" : "Sólo ida"}</h2>
            <p className="muted">Tocá cada recuadro: desde dónde sale, adónde va, y el día y la salida. La vuelta se suma con «Agregar vuelta».</p>
          </div>

          <ViajeSearchBar
            origenes={origenes}
            destinos={destinos}
            origen={origen}
            destino={destino}
            puedeInvertir={inversa.length > 0}
            tramos={tramos}
            ofrecerVuelta={ofrecerVuelta}
            onLugar={elegirLugar}
            onInvertir={() => cambiarRuta(destino, origen)}
            onDia={elegirDia}
            onSalida={elegirSalida}
            onAgregarVuelta={agregarVuelta}
            onQuitarVuelta={quitarVuelta}
          />
          <input type="hidden" name="scheduleId" value={salidaIda?.id ?? ""} />
          {vuelta.activa ? <input type="hidden" name="returnScheduleId" value={salidaVuelta?.id ?? ""} /> : null}
          <FieldError id="error-scheduleId" message={errores.scheduleId} />
          <FieldError id="error-returnScheduleId" message={errores.returnScheduleId} />

          {viajeListo ? (
            <div className="pickup-flow alta-secciones">
              {conParadas.length ? (
                <section className="leg-card" aria-label="Dónde baja">
                  {/* Una sección con su número; la ida y la vuelta van adentro, cada una con su ruta. */}
                  <header className="leg-head">
                    <span className="leg-badge" aria-hidden="true">1</span>
                    <div className="leg-head-text">
                      <span className="leg-kicker">Paradas</span>
                      <h3 className="leg-title">¿Dónde baja?</h3>
                    </div>
                  </header>
                  {conParadas.map((tramo) => (
                    <div key={tramo.clave} className="alta-paradas">
                      <p className="alta-paradas-tramo">
                        <b>{tramo.clave === "ida" ? "Ida" : "Vuelta"}</b> · {tramo.salida.from} → {tramo.salida.to}
                      </p>
                      <div className="alta-paradas-opciones" role="radiogroup" aria-label={`Dónde baja en la ${tramo.clave}`}>
                        {[{ name: "", label: tramo.salida.to, priceCents: tramo.salida.priceCents ?? 0 }, ...(tramo.salida.stopFares ?? []).map((fare) => ({ name: fare.name, label: fare.name, priceCents: fare.priceCents }))].map((opcion) => (
                          <button
                            key={opcion.name || "destino"}
                            type="button"
                            role="radio"
                            aria-checked={tramo.parada === opcion.name}
                            className="alta-parada"
                            onClick={() => tramo.cambiar(opcion.name)}
                          >
                            <b>{opcion.label}</b>
                            <small>{opcion.name ? "Parada en el camino" : "Destino final"} · {formatPrice(opcion.priceCents, tramo.salida.currency)}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ) : null}
              <input type="hidden" name="dropoffStop" value={paradaIda} />
              {vuelta.activa ? <input type="hidden" name="returnDropoffStop" value={paradaVuelta} /> : null}

              <section className="leg-card alta-pasajeros" aria-label="Pasajeros">
                <header className="leg-head">
                  <span className="leg-badge" aria-hidden="true">{conParadas.length ? 2 : 1}</span>
                  <div className="leg-head-text">
                    <span className="leg-kicker">Pasajeros</span>
                    <h3 className="leg-title">¿Cuántos viajan?</h3>
                  </div>
                </header>
                <div className="salida-pie">
                  <div className="salida-cantidad">
                    <span className="salida-cantidad-label">Lugares</span>
                    <div className="salida-stepper">
                      <button type="button" aria-label="Un lugar menos" disabled={lugares <= 1}
                        onClick={() => { const n = Math.max(1, lugares - 1); setLugares(n); setMedia((v) => Math.min(v, Math.max(n - sinCargo - 1, 0))); setSinCargo((v) => Math.min(v, Math.max(n - media - 1, 0))); }}>−</button>
                      <input type="number" name="passengerCount" min="1" max={maxLugares} value={lugares} readOnly aria-label="Lugares" />
                      <button type="button" aria-label="Un lugar más" disabled={lugares >= maxLugares}
                        onClick={() => setLugares(Math.min(maxLugares, lugares + 1))}>+</button>
                    </div>
                  </div>
                  <div className="salida-menores">
                    <label id="campo-halfFareCount">
                      Menores 4 a 8 · media
                      <input type="number" name="halfFareCount" min="0" max={lugares - sinCargo - 1} value={media}
                        aria-invalid={Boolean(errores.halfFareCount)}
                        onChange={(event) => setMedia(Math.max(0, Math.min(lugares - sinCargo - 1, Number(event.target.value) || 0)))} />
                    </label>
                    <label id="campo-freeFareCount">
                      Menores de 4 · sin cargo
                      <input type="number" name="freeFareCount" min="0" max={lugares - media - 1} value={sinCargo}
                        aria-invalid={Boolean(errores.freeFareCount)}
                        onChange={(event) => setSinCargo(Math.max(0, Math.min(lugares - media - 1, Number(event.target.value) || 0)))} />
                    </label>
                  </div>
                </div>
                <FieldError id="error-halfFareCount" message={errores.halfFareCount ?? errores.freeFareCount} />
                <p className="muted alta-nota">
                  {salidaVuelta
                    ? `Quedan ${salidaIda?.availableSeats} libres en la ida y ${salidaVuelta.availableSeats} en la vuelta.`
                    : `Quedan ${salidaIda?.availableSeats} libres en esta salida.`} Los menores de 4 no pagan pero ocupan lugar.
                </p>
                {salidaIda?.bookingMode === "SEATED" && lugares === 1 && !media && !sinCargo ? (
                  <label className="checkbox-row">
                    <input type="checkbox" name="requestDisabilityFare" />
                    Solicitar viaje gratuito por discapacidad
                  </label>
                ) : null}
              </section>

              <section className="leg-card alta-titular" aria-label="Datos del titular">
                <header className="leg-head">
                  <span className="leg-badge" aria-hidden="true">{conParadas.length ? 3 : 2}</span>
                  <div className="leg-head-text">
                    <span className="leg-kicker">Titular</span>
                    <h3 className="leg-title">Datos del pasajero</h3>
                  </div>
                  {datosListos ? <span className="leg-check" aria-label="Datos completos">✓</span> : null}
                </header>
                <div className="admin-form-grid alta-campos">
                  <label id="campo-firstName">
                    Nombre
                    <input autoComplete="given-name" required {...campo("firstName")} />
                    <FieldError id="error-firstName" message={errores.firstName} />
                  </label>
                  <label id="campo-lastName">
                    Apellido
                    <input autoComplete="family-name" required {...campo("lastName")} />
                    <FieldError id="error-lastName" message={errores.lastName} />
                  </label>
                  <label id="campo-email">
                    Email (opcional)
                    <input type="email" autoComplete="email" {...campo("email")} />
                    <FieldError id="error-email" message={errores.email} />
                  </label>
                  <label id="campo-phone">
                    Teléfono (opcional)
                    <input type="tel" autoComplete="tel" placeholder="+54 9..." {...campo("phone")} />
                    <FieldError id="error-phone" message={errores.phone} />
                  </label>
                  <label id="campo-documentType">
                    Tipo de documento
                    <select required {...campo("documentType")}><option>DNI</option><option>Pasaporte</option><option>Cedula</option></select>
                  </label>
                  <label id="campo-documentId">
                    Documento
                    <input required placeholder="7 u 8 dígitos si es DNI" {...campo("documentId")} />
                    <FieldError id="error-documentId" message={errores.documentId} />
                  </label>
                  <label className="span-2" id="campo-nationality">
                    Nacionalidad
                    <input placeholder="Opcional" {...campo("nationality")} />
                    <FieldError id="error-nationality" message={errores.nationality} />
                  </label>
                </div>
                <div className="admin-form-grid alta-campos">
                  <label id="campo-customPrice">
                    Precio total {vuelta.activa ? "del ida y vuelta" : "de la reserva"} (opcional)
                    <input inputMode="decimal" placeholder="Usar tarifa automática" {...campo("customPrice")} />
                    <small>{vuelta.activa ? "El importe de todo el viaje: se reparte mitad por tramo." : "Ingresá el importe para todos los lugares en la moneda de la salida."}</small>
                    <FieldError id="error-customPrice" message={errores.customPrice} />
                  </label>
                  <label id="campo-referredBy">
                    Derivado por (opcional)
                    <input maxLength={120} placeholder="Ej. una agencia de viajes" {...campo("referredBy")} />
                    <small>Quién vendió la reserva, si la venta vino de otra agencia o por un voucher.</small>
                    <FieldError id="error-referredBy" message={errores.referredBy} />
                  </label>
                </div>
              </section>
            </div>
          ) : null}
        </section>
      </div>

      <aside className="checkout-summary plain-card">
        <p className="eyebrow">Resumen</p>
        <h2 className="route-title">{vuelta.activa ? "Ida y vuelta" : "Reserva"}</h2>
        <div className="summary-list">
          <span>Ida: <strong>{salidaIda ? `${diaCorto(salidaIda.dayKey)} · ${salidaIda.timeLabel}` : "—"}</strong></span>
          <span>Recorrido: <strong>{origen || "—"} → {paradaIda || destino || "—"}</strong></span>
          {vuelta.activa ? (
            <>
              <span>Vuelta: <strong>{salidaVuelta ? `${diaCorto(salidaVuelta.dayKey)} · ${salidaVuelta.timeLabel}` : "—"}</strong></span>
              <span>Recorrido: <strong>{destino} → {paradaVuelta || origen}</strong></span>
            </>
          ) : null}
          <span>Lugares: <strong>{lugares}</strong></span>
          {media ? <span>Menores con media tarifa: <strong>{media}</strong></span> : null}
          {sinCargo ? <span>Menores de 4 sin cargo: <strong>{sinCargo}</strong></span> : null}
          {salidaIda && !precioAjustado ? (
            <span>Tarifa: <strong>
              {formatPrice(precioDelTramo(salidaIda, paradaIda), moneda)} la ida
              {salidaVuelta ? ` · ${formatPrice(precioDelTramo(salidaVuelta, paradaVuelta), moneda)} la vuelta` : ""}, por persona
            </strong></span>
          ) : null}
          {precioAjustado ? <span>Precio total ajustado por administración</span> : null}
        </div>
        {!precioAjustado ? <strong className="price">{salidaIda ? formatPrice(total, moneda) : "—"}</strong> : null}
        {!salidaIda ? (
          <button className="button checkout-submit" type="button" onClick={() => abrirCasillero("ida")}>Elegí la salida de ida</button>
        ) : vuelta.activa && !salidaVuelta ? (
          <button className="button checkout-submit" type="button" onClick={() => abrirCasillero("vuelta")}>Elegí la salida de la vuelta</button>
        ) : (
          <button className="button checkout-submit" type="submit" disabled={pending}>
            {pending ? "Guardando…" : vuelta.activa ? "Crear ida y vuelta" : "Crear reserva"}
          </button>
        )}
        <Link className="ghost-button alta-cancelar" href="/admin/reservas">Cancelar</Link>
      </aside>
    </form>
  );
}
