export const SCHOOL_RUN_KINDS = [
  { value: "escuela", label: "Escolar", tabLabel: "Escolares" },
  { value: "personal-aeropuerto", label: "Personal aeropuerto", tabLabel: "Personal aeropuerto" },
  { value: "otro", label: "Otro recurrente", tabLabel: "Otros recurrentes" }
] as const;

export type SchoolRunKind = (typeof SCHOOL_RUN_KINDS)[number]["value"];

const VALUES = new Set<string>(SCHOOL_RUN_KINDS.map((kind) => kind.value));

/** Cualquier valor viejo o ausente se sigue leyendo como recorrido escolar. */
export function normalizarTipoDeConcesion(value: unknown): SchoolRunKind {
  const kind = String(value ?? "").trim();
  return VALUES.has(kind) ? (kind as SchoolRunKind) : "escuela";
}

/** `null` = todos los servicios. */
export function leerTipoDeConcesion(value: unknown): SchoolRunKind | null {
  const kind = String(value ?? "").trim();
  return VALUES.has(kind) ? (kind as SchoolRunKind) : null;
}

export function etiquetaDeConcesion(value: unknown) {
  const kind = normalizarTipoDeConcesion(value);
  return SCHOOL_RUN_KINDS.find((item) => item.value === kind)!.label;
}
