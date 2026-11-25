"use client";

import { useEffect, useMemo, useState } from "react";
import type { ServicioApp } from "@/lib/driver/jornada-app-types";
import { borrarCopia } from "./almacen";
import { claveServicio, diaLocal, enHorario, hora, nombreNave } from "./estado-jornada";
import { useJornada } from "./uso-jornada";
import { DriverLocationPanel } from "./driver-location-panel";
import { HojaServicio } from "./hoja-servicio";

const diaFmt = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const largoFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

export function MiJornada({ identidad }: { identidad: string | null }) {
  const { chofer, datos, cola, alDia, mensaje, abrir, marcar, actualizar } = useJornada(identidad);
  const [ahora, setAhora] = useState<number | null>(null);
  const [elegido, setElegido] = useState("");
  const [claveHoja, setClaveHoja] = useState("");
  const [salida, setSalida] = useState("");
  useEffect(() => {
    const actualizarReloj = () => setAhora(Date.now());
    actualizarReloj();
    const reloj = window.setInterval(actualizarReloj, 3000);
    const volver = () => setClaveHoja(history.state?.hojaChofer ?? "");
    window.addEventListener("popstate", volver);
    return () => { window.clearInterval(reloj); window.removeEventListener("popstate", volver); };
  }, []);
  async function salir() {
    try {
      const res = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error();
      if (chofer) await borrarCopia(chofer).catch(() => {});
      window.location.assign("/login");
    } catch { setSalida("Necesitás conexión para cerrar la sesión."); }
  }
  function volver() {
    if (history.state?.hojaChofer) history.back();
    else setClaveHoja("");
    window.scrollTo(0, 0);
  }
  async function ver(servicio: ServicioApp) {
    if (!await abrir(servicio)) return;
    const clave = claveServicio(servicio);
    history.pushState({ ...history.state, hojaChofer: clave }, "");
    setClaveHoja(clave);
    window.scrollTo(0, 0);
  }
  const hoy = ahora ? diaLocal(ahora) : datos?.jornada.fecha;
  const dias = hoy ? Array.from({ length: 7 }, (_,i) => new Date(Date.parse(hoy + "T12:00:00Z") + i * 86400000).toISOString().slice(0,10)) : [];
  const dia = dias.includes(elegido) ? elegido : hoy;
  const servicios = datos?.jornada.servicios ?? [];
  const delDia = servicios.filter(s => s.fecha === dia);
  const diaDescargado = Boolean(datos && dia && dia >= datos.jornada.fecha && Date.parse(dia) < Date.parse(datos.jornada.fecha) + 7 * 86400000);
  const hoja = servicios.find(s => claveServicio(s) === claveHoja);
  const marcas = useMemo(() => [...datos?.marcas ?? [], ...cola], [datos?.marcas, cola]);
  const revisiones = marcas.filter(m => m.estado === "revision" && m.driverId === chofer);
  const finalizados = new Set(marcas.filter(m => m.tipo === "fin" && m.estado !== "revision")
    .map(m => JSON.stringify([m.servicioId, m.vehicleId, m.fecha])));
  const pendientes = delDia.filter(s => !finalizados.has(claveServicio(s)));
  const siguienteDia = servicios.find(s => dia && s.fecha > dia && dias.includes(s.fecha))?.fecha;
  const actual = dia === hoy && ahora ? pendientes.find(s => enHorario(s, ahora)) : undefined;
  const proxima = pendientes.find(s => !s.salida || dia !== hoy || !ahora || Date.parse(s.salida) >= ahora);
  const destacada = actual ?? proxima;
  const otras = delDia.filter(s => s !== destacada);
  return <main className="jornada-chofer">
    <header className="jc-barra"><div><span>Araucana</span><strong>Chofer</strong></div>
      {chofer && <button type="button" onClick={salir}>Salir</button>}
    </header>
    <div className="jc-cuerpo">
      {hoja && <button className="jc-volver" onClick={volver}>← Mi jornada</button>}
      <div className="jc-titulo"><h1>{hoja ? "Hoja de ruta" : "Mi jornada"}</h1>
        <span>{hoja ? largoFmt.format(new Date(hoja.fecha + "T12:00:00Z")) : hoy ? largoFmt.format(new Date(hoy + "T12:00:00Z")) : ""}</span></div>
      <div className="jc-sync" role="status">
        <span>{datos ? (alDia ? "Actualizado" : "Copia guardada") + " · " + new Date(datos.sincronizada).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : mensaje ? "Jornada sin descargar" : "Consultando tu jornada"}</span>
        {datos && <button onClick={actualizar}>Actualizar</button>}
      </div>
      {mensaje && <p className="jc-aviso" role="status">{mensaje}{!datos && <span> <a href="/chofer">Volver a entrar</a></span>}</p>}
      {salida && <p className="jc-aviso" role="alert">{salida}</p>}
      {cola.length > 0 && <p className="jc-aviso" role="status">Pendientes de envío · {cola.length}</p>}
      {revisiones.length > 0 && <details className="jc-aviso"><summary>Marcas en revisión · {revisiones.length}</summary><ul>{revisiones.map(m =>
        <li key={m.id}>{m.servicio ?? servicios.find(s => s.id === m.servicioId)?.titulo ?? "Servicio reasignado"} · {m.tipo} · {hora(m.at)}{m.motivo && " · " + m.motivo}</li>)}</ul></details>}
      {datos && ahora && chofer && <DriverLocationPanel servicios={servicios} ahora={ahora} hoja={hoja} alDia={alDia} chofer={chofer} />}
      {datos && (hoja ? <HojaServicio key={claveHoja} servicio={hoja} marcas={marcas} hoy={hoja.fecha === hoy} alDia={alDia} marcar={marcar} /> : <>
        {claveHoja && <p className="jc-aviso">Operaciones actualizó tu asignación. Elegí una hoja de tu jornada.</p>}
        <nav className="jc-dias" aria-label="Días de la agenda">{dias.map(d => <button key={d} aria-pressed={d === dia}
          onClick={() => { setElegido(d); setClaveHoja(""); }}><span>{d === hoy ? "Hoy" : diaFmt.format(new Date(d + "T12:00:00Z")).replace(".", "")}</span><b>{d.slice(-2)}</b></button>)}</nav>
        {destacada && <section className="jc-destacada"><div className="jc-entre"><b>{actual ? "En horario" : dia !== hoy ? "Primera salida" : proxima?.salida ? "Próxima salida" : "Servicio asignado"}</b><span className="jc-tipo">{destacada.tipo}</span></div>
          <h2>{destacada.titulo}</h2><dl><div><dt>Salida</dt><dd>{hora(destacada.salida)}{destacada.origen && " · " + destacada.origen}</dd></div>
            <div><dt>Nave asignada</dt><dd>{nombreNave(destacada.nave)}</dd></div>
            {destacada.paradas[0] && destacada.paradas[0] !== destacada.origen && <div><dt>Primera parada</dt><dd>{destacada.paradas[0]}</dd></div>}</dl>
          <button className="jc-primario" onClick={() => void ver(destacada)}>Ver hoja de ruta <span aria-hidden="true">→</span></button>
        </section>}
        {otras.length > 0 && <section className="jc-seccion"><h2>{destacada ? "Otros servicios" : "Servicios del día"}</h2>
          <ul className="jc-lista">{otras.map(s => <li key={claveServicio(s)}><button onClick={() => void ver(s)}>
            <time>{hora(s.salida)}</time><span><small>{s.tipo}</small><strong>{s.titulo}</strong><small>{nombreNave(s.nave)}{finalizados.has(claveServicio(s)) && " · Finalizado"}</small></span><b aria-hidden="true">→</b></button></li>)}</ul></section>}
        {!delDia.length && <section className="jc-seccion"><h2>{diaDescargado ? "Sin servicios asignados" : "Día sin descargar"}</h2><p>{diaDescargado ? "Operaciones todavía no cargó servicios para este día." : "Conectate para consultar las asignaciones de esta fecha."}</p>
          {siguienteDia && <div className="jc-acciones"><button onClick={() => setElegido(siguienteDia)}>Ver próxima salida · {largoFmt.format(new Date(siguienteDia + "T12:00:00Z"))}</button></div>}</section>}
      </>)}
    </div>
  </main>;
}
