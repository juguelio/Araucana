import type { DriverServiceMark } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { shiftDateKey } from "@/lib/operations/day-board";
import type { ServicioApp } from "./jornada-app-types";

export type Marca = DriverServiceMark;

// Las correcciones son cantidades absolutas por nave y fila. Un reintento viejo recibido
// tras una corrección reciente no la pisa. Las incidencias se conservan aparte.
export function ultimasMarcas(marcas: Marca[]) {
  const ultimas = new Map<string, Marca>();
  const revisiones: Marca[] = [];
  const ordenadas = [...marcas].sort((a, b) =>
    +a.at - +b.at || +a.receivedAt - +b.receivedAt || a.id.localeCompare(b.id));
  for (const marca of ordenadas) {
    if (marca.estado === "revision") {
      revisiones.push(marca);
      continue;
    }
    const clave = JSON.stringify([marca.fecha, marca.servicioId, marca.vehicleId, marca.tipo, marca.filaId]);
    ultimas.set(clave, marca);
  }
  return [...ultimas.values(), ...revisiones];
}

export function diferenciasDeEmbarque(marcasVigentes: Marca[]) {
  const filas = new Map<string, { total: number; prevista: number }>();
  for (const marca of marcasVigentes) {
    if (marca.estado !== "guardada" || marca.tipo !== "embarque" || !marca.filaId) continue;
    const key = JSON.stringify([marca.fecha, marca.servicioId, marca.filaId]);
    const anterior = filas.get(key);
    filas.set(key, { total: (anterior?.total ?? 0) + (marca.cantidad ?? 0), prevista: marca.prevista ?? 0 });
  }
  return new Set([...filas].filter(([, f]) => f.total > f.prevista).map(([k]) => k));
}

export async function marcasDeServicios(servicios: ServicioApp[], driverId: string, fecha: string) {
  const filas = await prisma.driverServiceMark.findMany({
    where: { fecha: { gte: fecha, lt: shiftDateKey(fecha, 7) }, OR: [
      { servicioId: { in: servicios.map(s => s.id) } }, { driverId, estado: "revision" }
    ] }
  });
  return ultimasMarcas(filas.filter(m => (m.estado === "revision" && m.driverId === driverId) || servicios.some(s => {
    if (s.id !== m.servicioId || s.fecha !== m.fecha) return false;
    if (m.estado === "revision") return false;
    if (m.tipo === "embarque" && !s.filas.some(f => f.id === m.filaId)) return false;
    return m.vehicleId === (s.nave?.id ?? null) || (s.compartida && m.tipo === "embarque");
  })));
}

export const horaDeMarca = (fecha: Date) => fecha.toLocaleTimeString("es-AR", {
  timeZone: "America/Argentina/Salta", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

export function resumenDeMarcas(vigentes: Marca[]) {
  if (!vigentes.length) return "Sin marcas informadas";
  const lineas: string[] = [];
  const unidades = new Map<string | null, Marca[]>();
  for (const m of vigentes) {
    if (m.estado !== "guardada") continue;
    const deUnidad = unidades.get(m.vehicleId) ?? [];
    deUnidad.push(m);
    unidades.set(m.vehicleId, deUnidad);
  }
  for (const registros of unidades.values()) {
    const inicio = registros.find(m => m.tipo === "inicio");
    const fin = registros.find(m => m.tipo === "fin");
    const embarques = registros.filter(m => m.tipo === "embarque");
    const partes = [registros[0].nave || "Sin nave"];
    if (inicio) partes.push("Inicio " + horaDeMarca(inicio.at));
    if (fin) partes.push("Fin " + horaDeMarca(fin.at));
    if (embarques.length) partes.push("Embarcados " + embarques.reduce((n, m) => n + (m.cantidad ?? 0), 0));
    lineas.push(partes.join(" · "));
  }
  const diferencias = diferenciasDeEmbarque(vigentes).size;
  const pendientes = vigentes.filter(m => m.estado === "revision").length;
  if (diferencias) lineas.push("Reservas con exceso de embarque · " + diferencias);
  if (pendientes) lineas.push("Marcas para revisar · " + pendientes);
  return lineas.join(" / ");
}
