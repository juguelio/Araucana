"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useActionState, useState } from "react";
import { createAdminReservationAction } from "../actions";
import { FieldError } from "../../form-ui";
import { initialAdminFormState } from "../../form-state";
import {
  PassengerFields, initialPassenger, validateCheckoutPassenger, type PassengerFieldErrors, type PassengerForm
} from "@/app/reservar/[slug]/passenger-fields";
import type { SalidaOption } from "./salida-picker-utils";
import { ViajeSearchBar, diaCorto, type ClaveTramo } from "./viaje-search-bar";
import { precioDelTramo, totalDelViaje, unificarLugares, type RutaDelPanel } from "./viaje-utils";
import { useViaje } from "./use-viaje";
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
 *
 * Los datos del titular son **el mismo formulario** que el del aeropuerto (`PassengerFields`, pedido
 * de Jugue, 19-nov: «quiero que sean iguales»): código de país con banderas, nacionalidad con buscador
 * y las mismas validaciones antes de mandar. Como el aeropuerto del panel, el email y el documento son
 * opcionales (19-nov): el alta se guarda igual sin DNI y la reserva queda marcada «Falta documento»
 * hasta que alguien lo complete (#122 pedía exigirlo; el mostrador no siempre lo tiene a mano).
 */
const VACIOS = {
  customPrice: "",
  referredBy: ""
};

type Draft = typeof VACIOS;

function formatPrice(cents: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function NuevaReservaForm({ schedules: salidasCrudas, rutas: rutasCrudas = [], inicio = null, aeropuerto = null }: {
  schedules: SalidaOption[];
  rutas?: RutaDelPanel[];
  /** El recorrido del servicio elegido arriba (pantalla única de «Reservar», 19-nov). */
  inicio?: { origen: string; destino: string } | null;
  /** El aeropuerto en Desde/Hacia (pantalla única de «Reservar», 19-nov). */
  aeropuerto?: React.ComponentProps<typeof ViajeSearchBar>["aeropuerto"];
}) {
  // Un nombre por lugar (con o sin tilde es el mismo) y todas las rutas activas, aunque no tengan
  // salidas cargadas (19-nov: «te están faltando rutas»).
  const { salidas: schedules, rutas } = useMemo(() => unificarLugares(salidasCrudas, rutasCrudas), [salidasCrudas, rutasCrudas]);
  const [state, formAction, pending] = useActionState(createAdminReservationAction, initialAdminFormState);
  const [draft, setDraft] = useState<Draft>(VACIOS);
  const [pasajero, setPasajero] = useState<PassengerForm>(initialPassenger);
  const formRef = useRef<HTMLFormElement>(null);
  // Los errores vienen del servidor o de revisar el pasajero antes de mandar (como el aeropuerto); cada
  // uno se borra cuando se corrige su campo.
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [mensajeLocal, setMensajeLocal] = useState("");
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    setErrores(state.status === "error" ? state.fieldErrors : {});
    setMensajeLocal("");
  }, [state]);
  const cantidadErrores = Object.keys(errores).length;
  const mensaje = mensajeLocal || state.message;

  function actualizarPasajero(nombre: keyof PassengerForm, valor: string) {
    setPasajero((actual) => ({ ...actual, [nombre]: valor }));
    setErrores((actual) => {
      if (!actual[nombre]) return actual;
      const siguiente = { ...actual };
      delete siguiente[nombre];
      return siguiente;
    });
  }

  /** Antes de mandar, el pasajero se revisa igual que en el aeropuerto: el error queda en su campo. */
  function revisarAntesDeMandar(event: React.FormEvent<HTMLFormElement>) {
    const encontrados = validateCheckoutPassenger(pasajero, true, true);
    const cantidad = Object.keys(encontrados).length;
    if (!cantidad) return;
    event.preventDefault();
    setErrores(encontrados as Record<string, string>);
    setMensajeLocal(cantidad > 1 ? `Hay ${cantidad} datos del pasajero para revisar.` : Object.values(encontrados)[0] ?? "Revisá los datos del pasajero.");
    setIntento((n) => n + 1);
  }

  const { barra, origen, destino, salidaIda, salidaVuelta, vuelta, viajeListo, moneda, paradaIda, paradaVuelta,
    setParadaIda, setParadaVuelta, rutaSinSalidas } = useViaje(schedules, rutas, inicio);
  // Los pasajeros.
  const [lugares, setLugares] = useState(1);
  const [media, setMedia] = useState(0);
  const [sinCargo, setSinCargo] = useState(0);

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
  }, [state, intento, cantidadErrores]);

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

  // El documento no entra acá: el alta se puede guardar sin DNI (19-nov) y la reserva queda marcada.
  const datosListos = Boolean(pasajero.firstName.trim() && pasajero.lastName.trim() && pasajero.phone.trim());
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
    <form className="checkout-layout alta-template" action={formAction} onSubmit={revisarAntesDeMandar} ref={formRef} noValidate>
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

          {mensaje && (
            <div className="form-alert error" role="alert" id="alta-resumen">
              <p>{mensaje}</p>
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

          <ViajeSearchBar {...barra} aeropuerto={aeropuerto} rutaSinSalidas={rutaSinSalidas} />
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
              <input type="hidden" name="boardingStop" value={salidaIda?.boardingStop ?? ""} />
              <input type="hidden" name="dropoffStop" value={salidaIda?.dropoffStop ?? paradaIda} />
              {vuelta.activa && <input type="hidden" name="returnBoardingStop" value={salidaVuelta?.boardingStop ?? ""} />}
              {vuelta.activa ? <input type="hidden" name="returnDropoffStop" value={salidaVuelta?.dropoffStop ?? paradaVuelta} /> : null}

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
                {/* El mismo formulario del pasajero que el aeropuerto y la reserva web. */}
                <PassengerFields
                  passenger={pasajero}
                  fieldErrors={errores as PassengerFieldErrors}
                  optionalIdentity
                  optionalDocument
                  disabled={pending}
                  onChange={actualizarPasajero}
                />
                {/* Precio y derivado: los mismos campos y textos que el aeropuerto del panel. */}
                <div className="checkout-fields">
                  <label id="campo-customPrice">
                    Precio total {vuelta.activa ? "del ida y vuelta" : "de la reserva"} ({moneda}, opcional)
                    <input inputMode="decimal" placeholder="Usar tarifa automática" disabled={pending} {...campo("customPrice")} />
                    {vuelta.activa ? <small>El importe de todo el viaje: se reparte mitad por tramo.</small> : null}
                    <FieldError id="error-customPrice" message={errores.customPrice} />
                  </label>
                  <label id="campo-referredBy">
                    Derivado por (opcional)
                    <input maxLength={120} placeholder="Ej. una agencia de viajes" disabled={pending} {...campo("referredBy")} />
                    <small>Quién vendió la reserva. Sale en la columna «Derivado por» de la orden de servicio del chofer.</small>
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
