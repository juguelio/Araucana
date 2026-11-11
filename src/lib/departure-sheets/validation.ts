import { z } from "zod";
import { normalizePassengerDocument, passengerDocumentError } from "@/lib/booking/passenger-contact";
import { departureSheetKinds, documentTypes, sexOptions, type DepartureSheetKind } from "./types";

/** Día argentino: el mediodía evita que la fecha se corra de día al guardarse en UTC. */
function dayAtNoon(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000-03:00`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

const birthDateField = z
  .string()
  .trim()
  .min(1, "Ingresá la fecha de nacimiento.")
  .transform((value, ctx) => {
    const date = dayAtNoon(value);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "Ingresá una fecha de nacimiento válida." });
      return z.NEVER;
    }
    const today = new Date();
    const oldest = new Date("1900-01-01T12:00:00.000-03:00");
    if (date > today) {
      ctx.addIssue({ code: "custom", message: "La fecha de nacimiento no puede ser futura." });
      return z.NEVER;
    }
    if (date < oldest) {
      ctx.addIssue({ code: "custom", message: "Revisá la fecha de nacimiento." });
      return z.NEVER;
    }
    return date;
  });

const passengerFields = {
  firstName: z.string().trim().min(2, "Ingresá el nombre.").max(60, "El nombre es demasiado largo."),
  lastName: z.string().trim().min(2, "Ingresá el apellido.").max(60, "El apellido es demasiado largo."),
  documentType: z.enum(documentTypes, { message: "Seleccioná el tipo de documento." }),
  documentNumber: z
    .string()
    .trim()
    .min(1, "Ingresá el número de documento.")
    .max(30, "El número de documento es demasiado largo."),
  sex: z.enum(sexOptions, { message: "Seleccioná el sexo." }),
  birthDate: birthDateField,
  nationality: z.string().trim().min(2, "Ingresá la nacionalidad.").max(60, "Revisá la nacionalidad.")
};

type PassengerFields = {
  documentType: string;
  documentNumber: string;
};

function checkDocument<T extends PassengerFields>(passenger: T, ctx: z.RefinementCtx) {
  const message = passengerDocumentError(passenger.documentType, passenger.documentNumber);
  if (message) {
    ctx.addIssue({ code: "custom", path: ["documentNumber"], message });
  }
}

const basePassengerSchema = z.object(passengerFields);

const provinciaPassengerSchema = z.object({
  ...passengerFields,
  occupation: z.string().trim().min(2, "Ingresá la ocupación.").max(80, "Revisá la ocupación."),
  residenceCountry: z.string().trim().min(2, "Ingresá el país de residencia.").max(60, "Revisá el país de residencia.")
});

/**
 * El formulario público muestra un juego de campos por tipo de planilla; el servidor valida con
 * el mismo criterio, porque la validación del navegador se saltea con un POST armado a mano.
 */
export function departurePassengerSchema(kind: DepartureSheetKind): z.ZodType<DeparturePassengerInput> {
  if (kind === "PROVINCIA") {
    return provinciaPassengerSchema
      .superRefine(checkDocument)
      .transform((passenger) => ({
        ...passenger,
        documentNumber: normalizePassengerDocument(passenger.documentType, passenger.documentNumber)
      }));
  }

  return basePassengerSchema
    .superRefine(checkDocument)
    .transform((passenger) => ({
      ...passenger,
      documentNumber: normalizePassengerDocument(passenger.documentType, passenger.documentNumber),
      occupation: null,
      residenceCountry: null
    }));
}

export type DeparturePassengerInput = {
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  sex: string;
  birthDate: Date;
  nationality: string;
  occupation: string | null;
  residenceCountry: string | null;
};

/** Formulario del panel para abrir una planilla nueva. */
export const createDepartureSheetSchema = z.object({
  kind: z.enum(departureSheetKinds, { message: "Elegí el tipo de planilla." }),
  title: z.string().trim().min(3, "Ponele un nombre a la planilla.").max(120, "El nombre es demasiado largo."),
  destination: z.string().trim().max(120, "Revisá el destino.").optional().default(""),
  departureAt: z
    .string()
    .trim()
    .optional()
    .default("")
    .transform((value, ctx) => {
      if (!value) return null;
      const date = dayAtNoon(value);
      if (!date) {
        ctx.addIssue({ code: "custom", message: "Revisá la fecha de salida." });
        return z.NEVER;
      }
      return date;
    }),
  borderCrossing: z.string().trim().max(120, "Revisá el paso fronterizo.").optional().default(""),
  notes: z.string().trim().max(600, "La nota es demasiado larga.").optional().default("")
});

export type CreateDepartureSheetInput = z.output<typeof createDepartureSheetSchema>;
