/**
 * Documentación de una unidad: póliza, revisión técnica, RTO y cédula.
 *
 * Cada subida es una fila y **el vigente de cada tipo es la última**: reemplazar un papel no borra
 * el anterior, así que el historial queda y el chofer siempre ve el que la empresa cargó al final.
 * Las fechas de vencimiento oficiales siguen en `Vehicle` (ver `compliance.ts`); el papel puede
 * declarar además su propio vencimiento, que es el que está impreso en el documento.
 */

export const TIPOS_DE_DOCUMENTO = ["POLIZA", "TECNICA", "RTO", "CEDULA"] as const;

export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

export const TIPO_DE_DOCUMENTO_LABEL: Record<TipoDeDocumento, string> = {
  POLIZA: "Póliza de seguro",
  TECNICA: "Revisión técnica (VTV)",
  RTO: "RTO nacional",
  CEDULA: "Cédula verde o azul"
};

/** El papel que respalda cada vencimiento de la ficha, para enlazarlos. */
export const PAPEL_DE_VENCIMIENTO: Record<"Póliza" | "Técnica" | "RTO", TipoDeDocumento> = {
  Póliza: "POLIZA",
  Técnica: "TECNICA",
  RTO: "RTO"
};

export const DOCUMENTO_MAX_BYTES = 10 * 1024 * 1024;

export const DOCUMENTO_TIPOS_ACEPTADOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

export function esTipoDeDocumento(valor: string | null | undefined): valor is TipoDeDocumento {
  return (TIPOS_DE_DOCUMENTO as readonly string[]).includes(valor ?? "");
}

/** Lo que se puede rechazar sin leer el archivo. El contenido se revisa aparte (firma del archivo). */
export function errorDeDocumento(file: { name: string; type: string; size: number }): string | null {
  if (!file.name.trim()) return "Elegí el archivo del papel.";
  if (file.size <= 0) return "El archivo está vacío.";
  if (file.size > DOCUMENTO_MAX_BYTES) return "El archivo no puede superar 10 MB.";
  if (!(DOCUMENTO_TIPOS_ACEPTADOS as readonly string[]).includes(file.type)) {
    return "El papel tiene que ser PDF, JPG, PNG o WebP.";
  }
  return null;
}

type DocumentoConFecha = { createdAt: Date };

/**
 * El vigente de cada tipo: la subida más reciente. Un tipo sin subidas queda ausente, para que la
 * pantalla diga «sin adjunto» en vez de inventar un papel.
 */
export function documentosVigentes<T extends DocumentoConFecha & { kind: string }>(
  documentos: T[]
): Partial<Record<TipoDeDocumento, T>> {
  const vigentes: Partial<Record<TipoDeDocumento, T>> = {};
  for (const documento of documentos) {
    if (!esTipoDeDocumento(documento.kind)) continue;
    const actual = vigentes[documento.kind];
    if (!actual || documento.createdAt.getTime() > actual.createdAt.getTime()) {
      vigentes[documento.kind] = documento;
    }
  }
  return vigentes;
}

/** Los cuatro papeles en el orden en que se controlan, con su vigente y su historial. */
export function documentosPorTipo<T extends DocumentoConFecha & { kind: string }>(
  documentos: T[]
): Array<{ tipo: TipoDeDocumento; label: string; vigente: T | null; historial: T[] }> {
  const vigentes = documentosVigentes(documentos);
  return TIPOS_DE_DOCUMENTO.map((tipo) => ({
    tipo,
    label: TIPO_DE_DOCUMENTO_LABEL[tipo],
    vigente: vigentes[tipo] ?? null,
    historial: documentos
      .filter((documento) => documento.kind === tipo)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(1)
  }));
}

/** dd/mm/aaaa para una fecha de calendario guardada a medianoche UTC (no se corre de día). */
export function fechaDePapel(fecha: Date | null | undefined): string {
  if (!fecha) return "—";
  const dia = String(fecha.getUTCDate()).padStart(2, "0");
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${fecha.getUTCFullYear()}`;
}

/** `2027-03-31` (lo que manda el input date) → medianoche UTC de ese día. `null` si no es válida. */
export function fechaDeVencimientoDelPapel(valor: string): Date | null {
  const limpio = valor.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return null;
  const fecha = new Date(`${limpio}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime())) return null;
  // Rechaza 2027-02-31: el constructor lo corre a marzo y la fecha deja de ser la que se escribió.
  return fecha.toISOString().slice(0, 10) === limpio ? fecha : null;
}

/**
 * La firma del archivo, no el MIME que declara el multipart. Un PDF renombrado a .jpg no se acepta
 * y un archivo que dice ser PDF pero no lo es tampoco.
 */
export async function firmaDeArchivoValida(file: { type: string; slice: (inicio: number, fin: number) => Blob }): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const coincide = (valores: number[], desde = 0) => valores.every((valor, indice) => bytes[desde + indice] === valor);
  if (file.type === "application/pdf") return coincide([0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (file.type === "image/jpeg") return coincide([0xff, 0xd8, 0xff]);
  if (file.type === "image/png") return coincide([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (file.type === "image/webp") return coincide([0x52, 0x49, 0x46, 0x46]) && coincide([0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

/** Qué se llama cada papel en el encabezado de la sección: «Póliza» en vez de «Póliza de seguro». */
export function tipoCorto(tipo: TipoDeDocumento): string {
  return tipo === "CEDULA" ? "Cédula" : tipo === "TECNICA" ? "Técnica" : tipo === "RTO" ? "RTO" : "Póliza";
}
