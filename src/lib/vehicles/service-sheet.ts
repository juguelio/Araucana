/**
 * Planilla de service de una nave: el catálogo de ítems que se revisan y las reglas para leer lo que
 * carga el taller. Sale de la planilla en papel del cliente («Planilla Service Vehículos»): se replica
 * ítem por ítem, en el mismo orden, para que el taller reconozca la pantalla sin aprender otra cosa.
 */

export type EstadoDeItem = "OK" | "FALLA" | "NA";

export type ItemDeService = { id: string; label: string };
export type SeccionDeService = { id: string; label: string; items: ItemDeService[] };
export type PlanillaLeida = { checks: Record<string, EstadoDeItem>; fallas: string[] };

export const SECCIONES_DE_SERVICE: SeccionDeService[] = [
  {
    id: "motor",
    label: "Motor",
    items: [
      { id: "fugas", label: "Fugas" },
      { id: "nivel-aceite", label: "Nivel de aceite" },
      { id: "nivel-agua", label: "Nivel de agua" },
      { id: "filtro-aire", label: "Filtro de aire" },
      { id: "aceite-hidraulico", label: "Aceite hidráulico" },
      { id: "correas-tensores", label: "Correas / tensores" },
      { id: "agua-sapitos", label: "Agua sapitos" }
    ]
  },
  {
    id: "luces",
    label: "Luces",
    items: [
      { id: "luces-altas", label: "Altas" },
      { id: "luces-bajas", label: "Bajas" },
      { id: "luces-posicion", label: "Posición" },
      { id: "luces-freno", label: "Freno" },
      { id: "luces-retroceso", label: "Retroceso" },
      { id: "giros", label: "Giros" },
      { id: "balizas", label: "Balizas" },
      { id: "luces-interior", label: "Interior" }
    ]
  },
  { id: "vidrios", label: "Vidrios", items: [{ id: "vidrios-general", label: "Vidrios en general" }] },
  {
    id: "transmision",
    label: "Transmisión",
    items: [
      { id: "aceite-caja", label: "Aceite caja" },
      { id: "aceite-diferencial", label: "Aceite diferencial" },
      { id: "crucetas", label: "Crucetas" },
      { id: "bolilleros-delanteros", label: "Bolilleros delanteros" },
      { id: "bolilleros-traseros", label: "Bolilleros traseros" }
    ]
  },
  {
    id: "arranque",
    label: "Arranque de motor",
    items: [
      { id: "bateria", label: "Batería" },
      { id: "bornes", label: "Bornes" },
      { id: "alternador", label: "Alternador" }
    ]
  },
  {
    id: "frenos",
    label: "Frenos",
    items: [
      { id: "freno-nivel-liquido", label: "Nivel líquido" },
      { id: "freno-de-mano", label: "Freno de mano" },
      { id: "freno-fuga-liquido", label: "Fuga líquido" },
      { id: "pastillas-delanteras", label: "Pastillas delanteras" },
      { id: "pastillas-traseras", label: "Pastillas traseras" }
    ]
  },
  {
    id: "tren-delantero",
    label: "Tren delantero",
    items: [
      { id: "amortiguadores-delanteros", label: "Amortiguadores delanteros" },
      { id: "amortiguadores-traseros", label: "Amortiguadores traseros" },
      { id: "bujes", label: "Bujes" }
    ]
  },
  {
    id: "cubiertas",
    label: "Cubiertas",
    items: [
      { id: "cubierta-delantera-derecha", label: "Delantera derecha" },
      { id: "cubierta-delantera-izquierda", label: "Delantera izquierda" },
      { id: "cubierta-trasera-derecha", label: "Trasera derecha" },
      { id: "cubierta-trasera-izquierda", label: "Trasera izquierda" },
      { id: "tuercas", label: "Tuercas" },
      { id: "auxilio", label: "Auxilio" },
      { id: "llantas", label: "Llantas" }
    ]
  },
  {
    id: "carroceria",
    label: "Carrocería y chasis",
    items: [
      { id: "escape", label: "Escape" },
      { id: "porton", label: "Portón" },
      { id: "puertas", label: "Puertas" },
      { id: "crique", label: "Crique" },
      { id: "matafuego", label: "Matafuego" },
      { id: "espejos", label: "Espejos" },
      { id: "bocina", label: "Bocina" },
      { id: "cinturones", label: "Cinturones" },
      { id: "asientos", label: "Asientos" }
    ]
  },
  {
    id: "cabina",
    label: "Cabina",
    items: [
      { id: "aire-acondicionado", label: "Aire acondicionado" },
      { id: "calefaccion", label: "Calefacción" }
    ]
  }
];

/** Todos los ítems, planos, con su sección: sirve para validar y para mostrar el resumen. */
export const ITEMS_DE_SERVICE: Array<ItemDeService & { seccion: string }> = SECCIONES_DE_SERVICE.flatMap((s) =>
  s.items.map((item) => ({ ...item, seccion: s.label }))
);

const IDS_DE_SERVICE = new Set(ITEMS_DE_SERVICE.map((i) => i.id));

export const ESTADOS_DE_ITEM: EstadoDeItem[] = ["OK", "FALLA", "NA"];
export const ESTADO_DE_ITEM_LABEL: Record<EstadoDeItem, string> = { OK: "Bien", FALLA: "Falla", NA: "No aplica" };

export function esEstadoDeItem(valor: string): valor is EstadoDeItem {
  return (ESTADOS_DE_ITEM as string[]).includes(valor);
}

export type PlanillaCruda = {
  servicedAt: string;
  odometerKm: string;
  workDone: string;
  notes: string;
  /** Un valor por ítem: `checks[<id>]`. Los que no vienen quedan sin revisar. */
  checks: Record<string, string>;
};

export type ResultadoDePlanilla =
  | { ok: true; data: { servicedAt: Date; odometerKm: number; workDone: string | null; notes: string | null; checks: Record<string, EstadoDeItem> } }
  | { ok: false; errores: Record<string, string> };

/** El día se guarda a medianoche UTC, igual que los días de Chapelco y los egresos. */
function diaUtc(fecha: string) {
  return new Date(`${fecha}T00:00:00Z`);
}

/**
 * Lee la planilla que manda el formulario. La fecha y el kilometraje son obligatorios —sin ellos la
 * planilla no sirve para llevar el mantenimiento—; de los ítems se acepta lo marcado y se ignora lo
 * que no existe en el catálogo, para que un cambio de planilla no rompa una carga vieja.
 */
export function leerPlanillaDeService(crudo: PlanillaCruda): ResultadoDePlanilla {
  const errores: Record<string, string> = {};

  const servicedAt = /^\d{4}-\d{2}-\d{2}$/.test(crudo.servicedAt) ? diaUtc(crudo.servicedAt) : null;
  if (!servicedAt || Number.isNaN(servicedAt.getTime())) errores.servicedAt = "Poné la fecha del service.";

  const kmLimpio = crudo.odometerKm.replace(/\./g, "").replace(/\s/g, "");
  const odometerKm = /^\d+$/.test(kmLimpio) ? Number(kmLimpio) : NaN;
  if (!Number.isFinite(odometerKm)) errores.odometerKm = "El kilometraje va en números, sin puntos.";
  else if (odometerKm <= 0) errores.odometerKm = "El kilometraje tiene que ser mayor a cero.";

  const checks: Record<string, EstadoDeItem> = {};
  for (const [id, estado] of Object.entries(crudo.checks)) {
    if (!IDS_DE_SERVICE.has(id)) continue;
    if (!esEstadoDeItem(estado)) continue;
    checks[id] = estado;
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores };

  return {
    ok: true,
    data: {
      servicedAt: servicedAt as Date,
      odometerKm,
      workDone: crudo.workDone.trim() || null,
      notes: crudo.notes.trim() || null,
      checks
    }
  };
}

export type ResumenDeService = { revisados: number; fallas: number; sinRevisar: number };

/** Cuántos ítems se revisaron y cuántos quedaron con falla: es lo que se ve en la ficha y el historial. */
export function resumenDePlanilla(checks: Record<string, EstadoDeItem>): ResumenDeService {
  const valores = Object.entries(checks).filter(([id]) => IDS_DE_SERVICE.has(id));
  return {
    revisados: valores.length,
    fallas: valores.filter(([, estado]) => estado === "FALLA").length,
    sinRevisar: ITEMS_DE_SERVICE.length - valores.length
  };
}

/** Los ítems con falla, con su nombre y sección, para listarlos en el historial. */
export function fallasDePlanilla(checks: Record<string, EstadoDeItem>) {
  return ITEMS_DE_SERVICE.filter((item) => checks[item.id] === "FALLA").map((item) => ({
    id: item.id,
    label: item.label,
    seccion: item.seccion
  }));
}

/** Lo que se guarda en la columna `checks` (JSON) o lo que vuelve de ella, siempre como objeto plano. */
export function checksGuardados(valor: unknown): Record<string, EstadoDeItem> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const salida: Record<string, EstadoDeItem> = {};
  for (const [id, estado] of Object.entries(valor as Record<string, unknown>)) {
    if (!IDS_DE_SERVICE.has(id)) continue;
    if (typeof estado === "string" && esEstadoDeItem(estado)) salida[id] = estado;
  }
  return salida;
}
