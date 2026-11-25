"use client";

import { memo, useState } from "react";
import type { FilaApp, ServicioApp } from "@/lib/driver/jornada-app-types";
import type { EnvioMarca, MarcaWeb } from "./almacen";
import { hora, marcasFila, nombreNave } from "./estado-jornada";

export type Marcar = (s: ServicioApp, tipo: EnvioMarca["tipo"], filaId?: string, cantidad?: number) => Promise<void>;

function FilaEmbarque({ fila, servicio, marcas, marcar, hoy }: { fila: FilaApp; servicio: ServicioApp; marcas: MarcaWeb[]; marcar: Marcar; hoy: boolean }) {
  const { propia, enOtras } = marcasFila(marcas, servicio, fila.id);
  const [editar, setEditar] = useState(false);
  const [cantidad, setCantidad] = useState("");
  const [guardando, setGuardando] = useState(false);
  const valor = cantidad.trim() ? Number(cantidad) : NaN;
  const maximo = fila.cantidad;
  const guardar = async (n: number) => {
    if (guardando) return;
    setGuardando(true);
    try { await marcar(servicio, "embarque", fila.id, n); setEditar(false); }
    finally { setGuardando(false); }
  };
  return <li className="jc-fila">
    <div className="jc-entre"><strong>{fila.nombre || "Reserva"}</strong><span>{fila.cantidad} {fila.cantidad === 1 ? "pasajero" : "pasajeros"}</span></div>
    {fila.detalle && <p>{fila.detalle}</p>}
    {fila.telefono && <a href={"tel:" + fila.telefono}>Llamar · {fila.telefono}</a>}
    <div className="jc-estado-fila">{propia ? propia.cantidad === 0 ? "Ausente en esta nave" : "Subieron en esta nave: " + propia.cantidad : fila.registroAnterior ?? "Sin informar"}
      {propia?.estado === "pendiente" ? " · Pendiente de envío" : ""}
      {enOtras > 0 && <span> · {enOtras} en otras naves</span>}
    </div>
    {(propia?.cantidad ?? 0) + enOtras > maximo && <p className="jc-aviso">El total informado supera la reserva. Revisá las cantidades con Operaciones.</p>}
    {hoy && servicio.nave && <div className="jc-acciones">
      {maximo > 0 && <button disabled={guardando} onClick={() => void guardar(maximo)}>{maximo === 1 ? "Subió 1" : "Subieron " + maximo}</button>}
      <button disabled={guardando} onClick={() => void guardar(0)}>Ausente</button>
      {fila.cantidad > 1 && <button onClick={() => { setCantidad(String(propia?.cantidad ?? "")); setEditar(!editar); }}>{editar ? "Cancelar" : "Otra cantidad"}</button>}
    </div>}
    {hoy && editar && <form className="jc-acciones" onSubmit={e => { e.preventDefault(); if (Number.isSafeInteger(valor) && valor >= 0 && valor <= maximo) void guardar(valor); }}>
      <label>Cantidad en esta nave <input autoFocus type="number" min={0} max={maximo} step={1} required inputMode="numeric" value={cantidad} onChange={e => setCantidad(e.target.value)} /></label>
      <button disabled={guardando || !Number.isSafeInteger(valor) || valor < 0 || valor > maximo}>Guardar</button>
    </form>}
  </li>;
}

export const HojaServicio = memo(function HojaServicio({ servicio, marcas, hoy, marcar, alDia }: { servicio: ServicioApp; marcas: MarcaWeb[]; hoy: boolean; marcar: Marcar; alDia: boolean }) {
  const s = servicio;
  const [guardando, setGuardando] = useState(false);
  const porNave = marcas.filter(m => m.servicioId === s.id && m.fecha === s.fecha && m.vehicleId === (s.nave?.id ?? null) && m.estado !== "revision");
  async function poner(tipo: "inicio" | "fin") {
    setGuardando(true);
    try { await marcar(s, tipo); }
    finally { setGuardando(false); }
  }
  return <article className="jc-hoja">
    <header className="jc-destacada">
      <span className="jc-tipo">{s.tipo}</span><h2>{s.titulo}</h2>
      <dl><div><dt>Salida</dt><dd>{hora(s.salida)}{s.origen && " · " + s.origen}</dd></div>
        <div><dt>Nave asignada</dt><dd>{nombreNave(s.nave)}</dd></div>
        {s.fin && <div><dt>Fin previsto</dt><dd>{hora(s.fin)}</dd></div>}</dl>
    </header>
    <section className="jc-seccion"><h3>Registro del servicio</h3>
      <div className="jc-acciones">{(["inicio", "fin"] as const).map(tipo => {
        const marca = porNave.filter(m => m.tipo === tipo).sort((a,b) => b.at.localeCompare(a.at))[0];
        return marca ? <p key={tipo}>{tipo === "inicio" ? "Inicio" : "Fin"} · {hora(marca.at)}{marca.estado === "pendiente" && " · Pendiente de envío"}</p> :
          hoy ? <button key={tipo} disabled={guardando} onClick={() => void poner(tipo)}>{tipo === "inicio" ? "Marcar inicio" : "Marcar fin"}</button> : null;
      })}</div>{!hoy && !porNave.length && <p>Disponible el día del servicio.</p>}
    </section>
    <section className="jc-seccion"><h3>Recorrido y paradas</h3>
      {s.paradas.length ? <ol className="jc-paradas">{s.paradas.map((p, i) => <li key={i}>{p}</li>)}</ol> : <p>Operaciones todavía no cargó las paradas.</p>}
      {s.indicaciones.length > 0 && <><h4>Indicaciones</h4><ul>{s.indicaciones.map((t,i) => <li key={i}>{t}</li>)}</ul></>}
    </section>
    <section className="jc-seccion"><h3>Pasajeros{s.filas.length > 0 && <small> · {s.filas.reduce((n, f) => n + f.cantidad, 0)} previstos</small>}</h3>
      {s.compartida && <p className="jc-aviso">Planilla compartida entre naves. Registrá cuántos pasajeros suben a tu unidad.</p>}
      {s.filas.length ? <ul className="jc-filas">{s.filas.map(f => <FilaEmbarque key={f.id} fila={f} servicio={s} hoy={hoy} marcas={marcas} marcar={marcar} />)}</ul> : <p>Sin nómina cargada para este servicio.</p>}
    </section>
    {s.nave && <section className="jc-seccion"><h3>Documentación de la nave</h3>
      {alDia ? <a className="jc-enlace" href={"/chofer/papeles?nave=" + encodeURIComponent(s.nave.id)}>Ver papeles de {s.nave.nombre} →</a> : <p>Conectate para consultar los documentos de {s.nave.nombre}.</p>}</section>}
  </article>;
});
