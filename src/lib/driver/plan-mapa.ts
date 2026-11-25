import type { NaveEnVivo } from "./en-vivo";
import { distanciaVisible } from "./mapa-vivo";

export type Punto = [number, number];
export type TramoPrevisto = { puntos: Punto[]; vial: boolean };
export type PlanMapa = {
  id: string;
  titulo: string;
  salida: number | null;
  fin: number | null;
  detalle: string;
  unidades: { id: string; nombre: string; chofer: string | null }[];
  tramos: TramoPrevisto[];
  completo: boolean;
};

const hora = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Salta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function datosDelPlan(plan: PlanMapa) {
  return [
    plan.titulo,
    [plan.salida === null ? "Salida sin horario" : `Salida ${hora.format(plan.salida)}`, plan.detalle].filter(Boolean).join(" · "),
    plan.unidades.map(u => [u.nombre, u.chofer].filter(Boolean).join(" · ")).join(" / ") || "Sin nave asignada"
  ];
}

// Plano tangente local en metros, suficiente para comparar la posición con un tramo vial corto.
function relativo(p: Punto, origen: Punto): Punto {
  return [(p[0] - origen[0]) * 111320, (p[1] - origen[1]) * 111320 * Math.cos(origen[0] * Math.PI / 180)];
}

export function distanciaAlSegmento(p: Punto, inicio: Punto, fin: Punto) {
  const [x, y] = relativo(p, inicio);
  const [dx, dy] = relativo(fin, inicio);
  const t = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - t * dx, y - t * dy);
}

export const MARGEN_VIAL = 500;

export function planesEnHorario(planes: PlanMapa[], vehicleId: string, instante: number) {
  return planes.filter(p => p.salida !== null && p.fin !== null && instante >= p.salida && instante < p.fin &&
    p.unidades.some(u => u.id === vehicleId));
}

export function seguimiento(nave: NaveEnVivo, planes: PlanMapa[], ahora: number) {
  const activos = planesEnHorario(planes, nave.vehicleId, ahora);
  if (!activos.length) return { texto: "Sin salida en curso", alerta: false };
  if (activos.length > 1) return { texto: "Asignaciones superpuestas", alerta: false };
  const plan = activos[0];
  const etiqueta = plan.titulo;
  const info = (estado: string, alerta = false) => ({ texto: `${etiqueta} · ${estado}`, alerta });
  if (nave.estado === "sin-senal" || Date.parse(nave.recordedAt) < plan.salida!) return info("Sin GPS reciente en esta salida");
  if (nave.accuracy != null && nave.accuracy > MARGEN_VIAL) return info("GPS impreciso");
  if (!plan.completo || !plan.tramos.length) return info("Sin trazado completo");
  const posicion: Punto = [nave.latitude, nave.longitude];
  const margen = MARGEN_VIAL + Math.max(0, nave.accuracy ?? 0);
  let distancia = Infinity;
  for (const tramo of plan.tramos) {
    for (let i = 1; i < tramo.puntos.length; i++) {
      const a = tramo.puntos[i - 1], b = tramo.puntos[i];
      const metros = distanciaAlSegmento(posicion, a, b);
      // Entre paradas sólo conocemos los extremos. Dentro de una zona amplia no inferimos desvíos.
      if (!tramo.vial && metros <= margen + Math.hypot(...relativo(b, a)) / 2) return info("Zona de paradas");
      distancia = Math.min(distancia, metros);
    }
  }
  if (!Number.isFinite(distancia)) return info("Sin trazado completo");
  return distancia > margen
    ? info(`Posible desvío · a ${distanciaVisible(distancia)} del trazado`, true)
    : info("En recorrido");
}
