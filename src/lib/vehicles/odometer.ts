/**
 * Kilometraje entre services (#369).
 *
 * El service guarda el km con el que se hizo; las lecturas sueltas dicen cuánto se recorrió desde
 * entonces. Con el intervalo de la unidad se avisa antes de pasarse. Nada de esto bloquea la unidad:
 * es información para decidir cuándo mandarla al taller.
 */

/** Cuántos km antes del service se avisa. */
export const UMBRAL_PROXIMO_KM = 1000;

export type EstadoKilometraje = {
  estado: "sin-dato" | "ok" | "proximo" | "vencido";
  /** Km recorridos desde el último service con dato; null si falta el dato. */
  recorridos: number | null;
  /** Km que faltan para el próximo service; negativo = ya se pasó. */
  faltan: number | null;
};

export function estadoKilometraje({
  intervalo,
  ultimoServiceKm,
  ultimaLecturaKm,
  umbral = UMBRAL_PROXIMO_KM
}: {
  intervalo: number | null | undefined;
  ultimoServiceKm: number | null | undefined;
  ultimaLecturaKm: number | null | undefined;
  umbral?: number;
}): EstadoKilometraje {
  if (!intervalo || intervalo <= 0) return { estado: "sin-dato", recorridos: null, faltan: null };
  if (ultimoServiceKm == null || ultimaLecturaKm == null) return { estado: "sin-dato", recorridos: null, faltan: null };
  // Una lectura menor al km del service es un dato viejo o mal tipeado: no se inventa un aviso.
  if (ultimaLecturaKm < ultimoServiceKm) return { estado: "sin-dato", recorridos: null, faltan: null };
  const recorridos = ultimaLecturaKm - ultimoServiceKm;
  const faltan = intervalo - recorridos;
  if (faltan < 0) return { estado: "vencido", recorridos, faltan };
  if (faltan <= umbral) return { estado: "proximo", recorridos, faltan };
  return { estado: "ok", recorridos, faltan };
}

/** «Faltan 2.300 km para el service» · «Pasado por 500 km» · «Sin intervalo definido». */
export function textoKilometraje(estado: EstadoKilometraje): string {
  if (estado.estado === "sin-dato" || estado.faltan == null) return "Sin datos para calcular el próximo service.";
  const n = (valor: number) => Math.abs(valor).toLocaleString("es-AR");
  if (estado.estado === "vencido") return `Pasado por ${n(estado.faltan)} km: corresponde el service.`;
  if (estado.estado === "proximo") return `Faltan ${n(estado.faltan)} km para el service.`;
  return `Faltan ${n(estado.faltan)} km para el service.`;
}
