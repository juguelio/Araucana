import { z } from "zod";
import { validateReceiptContent } from "@/lib/payments/receipt-validation";

export const MAX_EXCURSION_PHOTOS = 12;
export const MAX_EXCURSION_PHOTO_BYTES = 3 * 1024 * 1024;
const zone = "America/Argentina/Salta";

export class ExcursionError extends Error {}

function departureDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00-03:00`);
  if (!Number.isFinite(date.getTime()) || excursionLocalDateTime(date) !== value) return null;
  return date;
}

const draftSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(12000),
  duration: z.string().trim().min(1).max(120),
  currency: z.enum(["ARS", "USD"]),
  price: z.string().trim(),
  isPublished: z.boolean(),
  departures: z.array(z.string()).max(100)
});

export function parseExcursionForm(form: FormData) {
  const value = (name: string) => String(form.get(name) ?? "").trim();
  let input: z.infer<typeof draftSchema>;
  try {
    input = draftSchema.parse({ name: value("name"), description: value("description"), duration: value("duration"), price: value("price"), currency: value("currency"), isPublished: value("isPublished") === "on", departures: JSON.parse(value("departures") || "[]") });
  } catch {
    throw new ExcursionError("Revisá nombre, descripción, duración, moneda y fechas (hasta 100 salidas). ");
  }
  let priceCents: number | null = null;
  if (input.price) {
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(input.price)) throw new ExcursionError("Ingresá un precio sin separador de miles, o dejalo vacío para consultar.");
    priceCents = Math.round(Number(input.price.replace(",", ".")) * 100);
    if (!Number.isSafeInteger(priceCents) || priceCents <= 0 || priceCents > 2147483647) throw new ExcursionError("El precio debe ser mayor a cero y estar dentro del rango permitido.");
  }
  const departures = input.departures.map((value) => {
    const date = departureDate(value);
    if (!date) throw new ExcursionError("Revisá las fechas y horas de salida (hora argentina).");
    return date;
  });
  if (new Set(input.departures).size !== departures.length) throw new ExcursionError("Hay fechas de salida repetidas.");
  return { name: input.name, description: input.description, duration: input.duration, priceCents, currency: input.currency, isPublished: input.isPublished, departures };
}

export function excursionLocalDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function formatExcursionDate(date: Date, locale: "es" | "en" | "pt" = "es") {
  return new Intl.DateTimeFormat({ es: "es-AR", en: "en-US", pt: "pt-BR" }[locale], { timeZone: zone, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export async function validateExcursionPhoto(file: File) {
  if (file.size <= 0 || file.size > MAX_EXCURSION_PHOTO_BYTES) return "Elegí una foto de hasta 3 MB.";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "La foto debe ser JPG, PNG o WebP.";
  return await validateReceiptContent(file) ? "El contenido no corresponde a una imagen válida." : null;
}
