export const SCHOOL_RUN_KINDS = [
  { value: "escuela", label: "Escolar", tabLabel: "Escolares" },
  { value: "personal-aeropuerto", label: "Personal aeropuerto", tabLabel: "Personal aeropuerto" },
  { value: "otro", label: "Otro recurrente", tabLabel: "Otros recurrentes" }
] as const;

export type SchoolRunKind = (typeof SCHOOL_RUN_KINDS)[number]["value"];

const VALUES = new Set<string>(SCHOOL_RUN_KINDS.map((kind) => kind.value));

/** Los recorridos sin tipo siguen siendo escolares. */
export function normalizarTipoDeConcesion(value: unknown): SchoolRunKind {
  return leerTipoDeConcesion(value) ?? "escuela";
}

/** `null` = todos los servicios. */
export function leerTipoDeConcesion(value: unknown): SchoolRunKind | null {
  const kind = String(value ?? "").trim().toLowerCase();
  if (kind === "personal") return "personal-aeropuerto";
  if (kind === "escolar") return "escuela";
  return VALUES.has(kind) ? (kind as SchoolRunKind) : null;
}

export function etiquetaDeConcesion(value: unknown) {
  const kind = normalizarTipoDeConcesion(value);
  return SCHOOL_RUN_KINDS.find((item) => item.value === kind)!.label;
}
