"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JornadaApp, ServicioApp } from "@/lib/driver/jornada-app-types";
import { borrarCopia, choferGuardado, guardarCopia, leerCola, leerCopia, ponerEnCola, quitarDeCola,
  type Copia, type EnvioMarca, type MarcaWeb } from "./almacen";

import { claveServicio, diaLocal } from "./estado-jornada";

async function obtener(url: string, signal: AbortSignal) {
  const res = await fetch(url, { cache: "no-store", signal });
  if (res.status === 401 || res.status === 403) throw new Error("sesion");
  if (!res.ok) throw new Error("servidor");
  return res.json();
}

export function useJornada(identidad: string | null) {
  const [chofer, setChofer] = useState<string | null>(null);
  const [datos, setDatos] = useState<Copia>();
  const [cola, setCola] = useState<MarcaWeb[]>([]);
  const [alDia, setAlDia] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const actual = useRef<Copia | undefined>(undefined);
  const sincronizar = useRef<() => void>(() => {});
  const autorizado = useRef(false);

  useEffect(() => {
    const id = identidad ?? choferGuardado();
    if (!id) { setMensaje("Iniciá sesión con conexión para descargar tu jornada."); return; }
    const driverId = id;
    setChofer(id);
    let vivo = true;
    let ocupado = false;
    let repetir = false;
    let vinculoPrevio = choferGuardado() === driverId;
    const control = new AbortController();
    const timeout = () => typeof AbortSignal.any === "function" ? AbortSignal.any([control.signal, AbortSignal.timeout(15000)]) : control.signal;
    const vinculoValido = () => vivo && choferGuardado() === driverId;

    async function cerrarSesionLocal() {
      autorizado.current = false;
      actual.current = undefined;
      setDatos(undefined);
      setCola([]);
      setAlDia(false);
      setMensaje("La sesión cambió. Volvé a entrar para consultar tu jornada.");
      await borrarCopia(driverId).catch(() => {});
    }

    async function cargar() {
      if (ocupado) { repetir = true; return; }
      ocupado = true;
      try {
        do {
          repetir = false;
          if (!vivo || !navigator.onLine) return;
          const [jornada, respuesta] = await Promise.all([
            obtener("/api/v1/driver/jornada", timeout()) as Promise<JornadaApp & { driverId: string }>,
            obtener("/api/v1/driver/marcas", timeout()) as Promise<{ marcas: MarcaWeb[] }>
          ]);
          if (!vivo) return;
          if (jornada.driverId !== driverId) throw new Error("sesion");
          // Las sesiones anteriores a la jornada móvil adquieren el vínculo al renovarse.
          if (identidad && !vinculoPrevio && !choferGuardado()) {
            const renovada = await fetch("/api/v1/auth/refresh", { method: "POST", signal: timeout() });
            if (!renovada.ok) throw new Error(renovada.status === 401 ? "sesion" : "servidor");
          }
          if (!vinculoValido()) throw new Error("sesion");
          vinculoPrevio = true;
          autorizado.current = true;
          let falloDisco = false;
          const pendientes = await leerCola(driverId).catch(() => { falloDisco = true; return [] as MarcaWeb[]; });
          let marcas = respuesta.marcas;
          let falloEnvio = "";
          const confirmadas: string[] = [];
          for (const m of pendientes.sort((a, b) => a.at.localeCompare(b.at))) {
            if (!vinculoValido()) return;
            const { estado: _estado, driverId: _driverId, motivo: _motivo, fecha: _fecha, servicio: _servicio, ...envio } = m;
            const r = await fetch("/api/v1/driver/marcas", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(envio), signal: timeout() });
            if (r.status === 401) throw new Error("sesion");
            if (!r.ok) {
              const error = await r.json().catch(() => null);
              falloEnvio = typeof error?.error?.message === "string" ? error.error.message : "Hay marcas pendientes de envío.";
              continue;
            }
            const ack = await r.json() as { estado: "guardada" | "revision"; motivo?: string };
            if (!vinculoValido()) return;
            marcas = [...marcas.filter(x => x.id !== m.id), { ...m, ...ack }];
            confirmadas.push(m.id);
          }
          if (!vinculoValido()) return;
          const hojasPrevias = new Set(actual.current?.hojas);
          const hoy = diaLocal(Date.now());
          const hojas = jornada.servicios.filter(s => s.fecha === hoy || hojasPrevias.has(claveServicio(s))).map(claveServicio);
          const copia = { jornada, hojas, marcas, sincronizada: new Date().toISOString() };
          actual.current = copia;
          setDatos(copia);
          setAlDia(true);
          await guardarCopia(driverId, copia).catch(() => { falloDisco = true; });
          if (!falloDisco) await Promise.all(confirmadas.map(quitarDeCola));
          const restantes = await leerCola(driverId).catch(() => []);
          if (!vinculoValido()) return;
          setCola(restantes);
          setMensaje(falloDisco ? "Este dispositivo no pudo guardar las hojas para usarlas sin conexión."
            : falloEnvio ? falloEnvio + " Volveremos a intentar el envío." : "");
        } while (repetir && vivo);
      } catch (error) {
        if (!vivo) return;
        if ((error as Error).message === "sesion") await cerrarSesionLocal();
        else { setAlDia(false); setMensaje("Sin actualización. Mostramos lo último que quedó guardado."); }
      } finally { ocupado = false; }
    }

    const offline = () => { setAlDia(false); setMensaje("Sin conexión. Tus marcas quedan pendientes de envío."); };
    const refrescar = () => {
      if (document.visibilityState !== "visible" || !vivo) return;
      if (autorizado.current && !vinculoValido()) { void cerrarSesionLocal(); return; }
      void cargar();
    };
    sincronizar.current = cargar;
    async function iniciar() {
      if (choferGuardado() === id) {
        const [copia, pendientes] = await Promise.all([leerCopia(driverId), leerCola(driverId)]).catch(() => [undefined, []] as const);
        if (!vinculoValido()) return;
        autorizado.current = true;
        actual.current = copia;
        setDatos(copia);
        setCola([...pendientes]);
      }
      if (navigator.onLine) void cargar(); else offline();
    }
    void iniciar();
    if (identidad && "serviceWorker" in navigator) {
      // Una nueva compilación descarga su propio inicio y sus chunks antes de reemplazar el anterior.
      const chunks = Array.from(document.scripts, s => s.src).filter(url => url.includes("/_next/static/")).sort().join("|");
      let version = 0;
      for (let i = 0; i < chunks.length; i++) version = (Math.imul(31, version) + chunks.charCodeAt(i)) >>> 0;
      void navigator.serviceWorker.register("/chofer-sw.js?v=" + version.toString(36), { scope: "/chofer" })
        .catch(() => { if (vivo) setMensaje("No se pudo preparar el inicio sin conexión. Mantené esta pestaña abierta."); });
    }
    window.addEventListener("online", refrescar);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", refrescar);
    const reloj = window.setInterval(refrescar, 30000);
    return () => {
      vivo = false;
      control.abort();
      autorizado.current = false;
      window.clearInterval(reloj);
      window.removeEventListener("online", refrescar);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, [identidad]);

  const abrir = useCallback(async (s: ServicioApp) => {
    const copia = actual.current;
    if (!copia || !chofer || !autorizado.current || choferGuardado() !== chofer) return false;
    const clave = claveServicio(s);
    if (copia.hojas.includes(clave)) return true;
    if (!alDia) { setMensaje("Conectate para descargar esta hoja por primera vez."); return false; }
    const nueva = { ...copia, hojas: [...copia.hojas, clave] };
    actual.current = nueva;
    setDatos(nueva);
    await guardarCopia(chofer, nueva).catch(() => setMensaje("No se pudo guardar esta hoja en el dispositivo."));
    return true;
  }, [chofer, alDia]);

  const marcar = useCallback(async (s: ServicioApp, tipo: EnvioMarca["tipo"], filaId?: string, cantidad?: number) => {
    if (s.fecha !== diaLocal(Date.now())) { setMensaje("Las marcas se cargan el día del servicio."); return; }
    if (!chofer || !autorizado.current || choferGuardado() !== chofer) { setMensaje("Volvé a entrar con tu cuenta."); return; }
    const marca: MarcaWeb = { id: crypto.randomUUID(), servicioId: s.id, vehicleId: s.nave?.id ?? null,
      tipo, filaId, cantidad, at: new Date().toISOString(), comprobante: s.comprobante, fecha: s.fecha, servicio: s.titulo, driverId: chofer, estado: "pendiente" };
    try {
      await ponerEnCola(marca);
      setCola(p => [...p, marca]);
      sincronizar.current();
    } catch {
      setMensaje("La marca no se pudo guardar en este dispositivo. Reintentá cuando haya espacio disponible.");
    }
  }, [chofer]);

  return { chofer, datos, cola, alDia, mensaje, abrir, marcar, actualizar: () => sincronizar.current() };
}
