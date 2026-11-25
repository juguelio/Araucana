"use client";

import { useEffect, useState } from "react";
import type { ServicioApp } from "@/lib/driver/jornada-app-types";
import { DRIVER_LOCATION_UPDATE_INTERVAL_MS } from "@/lib/driver/location";
import { admiteGPSManual, claveServicio, diaLocal, hora, objetivoGPS } from "./estado-jornada";
import { choferGuardado } from "./almacen";

type Navegador = Navigator & {
  getBattery?: () => Promise<{ level: number; charging: boolean }>;
  connection?: { effectiveType?: string; type?: string };
};

type Props = { servicios: ServicioApp[]; hoja?: ServicioApp; ahora: number; alDia: boolean; chofer: string };
export function DriverLocationPanel({ servicios, hoja, ahora, alDia, chofer }: Props) {
  const [manual, setManual] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [ultima, setUltima] = useState<{ id: string; at: string }>();
  const objetivo = objetivoGPS(servicios, ahora, manual);
  const id = objetivo.servicio?.id;
  const nave = objetivo.servicio?.nave?.id;
  const fin = objetivo.servicio?.fin;
  const fecha = objetivo.servicio?.fecha;
  const esManual = objetivo.manual;
  const manualDisponible = hoja && admiteGPSManual(hoja, ahora);

  useEffect(() => {
    if (!manual || servicios.some(s => claveServicio(s) === manual && admiteGPSManual(s, ahora))) return;
    setManual(null);
  }, [ahora, manual, servicios]);

  useEffect(() => {
    setMensaje("");
    setUltima(undefined);
    if (!alDia || !id || !nave || bloqueado) return;
    if (!navigator.geolocation) { setMensaje("Este dispositivo no tiene GPS disponible."); return; }
    const controlador = new AbortController();
    let leyendo = false;
    const autorizado = () => !controlador.signal.aborted && choferGuardado() === chofer && navigator.onLine &&
      document.visibilityState === "visible" && (esManual ? diaLocal(Date.now()) === fecha && (!fin || Date.now() < Date.parse(fin)) : fin != null && Date.now() < Date.parse(fin));
    function ubicar() {
      if (leyendo || !autorizado()) return;
      leyendo = true;
      navigator.geolocation.getCurrentPosition(async pos => {
        try {
          if (!autorizado()) return;
          const nav = navigator as Navegador;
          const bateria = await nav.getBattery?.().catch(() => null);
          if (!autorizado()) return;
          const c = pos.coords;
          const res = await fetch("/api/v1/driver/location", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: controlador.signal,
            body: JSON.stringify({ servicioId: id, vehicleId: nave, manual: esManual, recordedAt: new Date(pos.timestamp).toISOString(),
              latitude: c.latitude, longitude: c.longitude, altitude: c.altitude, altitudeAccuracy: c.altitudeAccuracy,
              speed: c.speed, heading: c.heading, accuracy: c.accuracy, batteryLevel: bateria?.level, batteryCharging: bateria?.charging,
              clientNetworkType: nav.connection?.effectiveType ?? nav.connection?.type })
          });
          if (!autorizado() || !id) return;
          if (res.ok) { setUltima({ id, at: new Date(pos.timestamp).toISOString() }); setMensaje(""); }
          else { setUltima(undefined); setMensaje("La ubicación no se pudo enviar. Verificá tu asignación."); }
        } catch { if (autorizado()) { setUltima(undefined); setMensaje("Sin señal para enviar la ubicación."); } }
        finally { leyendo = false; }
      }, error => {
        leyendo = false;
        if (!autorizado()) return;
        setUltima(undefined);
        if (error.code === error.PERMISSION_DENIED) setBloqueado(true);
        else setMensaje("Esperando una señal GPS del dispositivo.");
      }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 });
    }
    ubicar();
    const reloj = window.setInterval(ubicar, DRIVER_LOCATION_UPDATE_INTERVAL_MS);
    document.addEventListener("visibilitychange", ubicar);
    return () => { controlador.abort(); window.clearInterval(reloj); document.removeEventListener("visibilitychange", ubicar); };
  }, [alDia, bloqueado, chofer, esManual, fecha, fin, id, nave]);

  let estado = "Fuera del horario de servicio";
  if (objetivo.conflicto) estado = "En pausa · Hay naves superpuestas. Consultá a Operaciones.";
  else if (!alDia) estado = "En pausa · Sin conexión con Operaciones";
  else if (id) estado = bloqueado ? "Sin permiso · Habilitá la ubicación del navegador" : mensaje ||
    (ultima?.id === id ? "Compartiendo · Última señal " + hora(ultima.at) : "Esperando ubicación");
  else if (manualDisponible) estado = "Disponible para este servicio sin franja horaria";

  return <aside className="jc-gps" aria-label="Ubicación del chofer">
    <span className={"jc-dot" + (ultima?.id && ultima.id === id && alDia && !mensaje && !bloqueado ? " activo" : "")} />
    <div><strong>GPS</strong><span>{estado}</span>
      {id && objetivo.servicio && <small>{objetivo.servicio.titulo} · {objetivo.servicio.nave?.nombre}</small>}
    </div>
    {bloqueado && id && <button type="button" onClick={() => setBloqueado(false)}>Reintentar</button>}
    {manual && <button type="button" onClick={() => setManual(null)}>Finalizar GPS manual</button>}
    {!manual && manualDisponible && !objetivo.servicio && !objetivo.conflicto && alDia && <button type="button" onClick={() => setManual(claveServicio(hoja))}>Compartir GPS</button>}
  </aside>;
}
