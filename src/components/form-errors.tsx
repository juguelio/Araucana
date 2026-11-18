"use client";

import { useEffect } from "react";

/**
 * Errores de formulario, compartidos por el alta del panel y los checkouts públicos (#242).
 *
 * Antes el error llegaba como un cartel arriba y el campo roto quedaba igual que el resto: el que
 * carga tenía que buscar a mano cuál de los diez campos estaba mal. Acá viven las tres piezas que
 * faltaban, una sola vez para todos los formularios:
 *
 * - `orderedFieldErrors`: los errores en el orden en que se ven en pantalla, no en el que los
 *   devuelve el servidor (Object.keys de un objeto Zod no respeta el formulario).
 * - `focusFirstInvalid`: mueve el foco y scrollea al primer campo con error.
 * - `FormErrorSummary`: el resumen de arriba, **sólo cuando hay más de un error**, con un link por
 *   campo. Con un solo error el mensaje inline alcanza y el resumen sería ruido.
 */

export type FieldErrorMap = Partial<Record<string, string>>;

/** Etiquetas para el resumen; la clave es el `name` del campo. */
const FIELD_LABELS: Record<string, string> = {
  scheduleId: "Salida",
  dropoffStop: "Parada",
  passengerCount: "Cantidad de pasajeros",
  firstName: "Nombre",
  lastName: "Apellido",
  email: "Email",
  phoneCountryCode: "Código de país",
  phone: "Teléfono",
  documentType: "Tipo de documento",
  documentId: "Documento",
  nationality: "Nacionalidad",
  customPrice: "Precio total",
  referredBy: "Derivado por",
  flight: "Vuelo",
  pickupAddress: "Dirección",
  pickupName: "Lugar de búsqueda",
  pickupLatitude: "Ubicación en el mapa",
  pickupLongitude: "Ubicación en el mapa",
  serviceDate: "Fecha",
  ascentSlot: "Horario de subida"
};

export type FieldErrorEntry = { name: string; message: string };

/**
 * Errores ordenados como se ven en el formulario. `order` lista los campos en el orden de la
 * pantalla; lo que no está en la lista va al final, alfabético, para que el resultado sea estable.
 */
export function orderedFieldErrors(
  fieldErrors: FieldErrorMap | undefined,
  order: readonly string[] = []
): FieldErrorEntry[] {
  const entries = Object.entries(fieldErrors ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    .map(([name, message]) => ({ name, message }));

  const rank = (name: string) => {
    const index = order.indexOf(name);
    return index === -1 ? order.length : index;
  };

  return entries.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

type FocusableField = {
  focus: () => void;
  scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
};

/**
 * Foco y scroll al primer campo con error. `lookup` resuelve el campo por `name`; si un error no
 * tiene control (p. ej. el servidor rechaza la salida entera), se saltea y sigue con el siguiente.
 * Devuelve el nombre enfocado, o `null` si no había ninguno.
 */
export function focusFirstInvalid(
  fieldErrors: FieldErrorMap | undefined,
  order: readonly string[],
  lookup: (name: string) => FocusableField | null
): string | null {
  for (const entry of orderedFieldErrors(fieldErrors, order)) {
    const field = lookup(entry.name);
    if (!field) {
      continue;
    }
    field.focus();
    field.scrollIntoView?.({ block: "center", behavior: "smooth" });
    return entry.name;
  }

  return null;
}

/** Busca el control por `name` dentro de un formulario (o del documento). */
export function fieldLookup(root: ParentNode | null | undefined) {
  return (name: string): FocusableField | null => {
    const scope = root ?? (typeof document === "undefined" ? null : document);
    if (!scope) return null;
    return (scope.querySelector(`[name="${name}"]`) as unknown as FocusableField | null) ?? null;
  };
}

/**
 * Después de cada envío fallido, el foco va al primer campo con error. Se dispara con la firma de
 * los errores (no con el objeto) para no re-enfocar en cada render del formulario.
 */
export function useFocusFirstError(
  fieldErrors: FieldErrorMap | undefined,
  order: readonly string[],
  formRef?: { current: HTMLElement | null }
) {
  const signature = orderedFieldErrors(fieldErrors, order).map((entry) => entry.name).join("|");

  useEffect(() => {
    if (!signature) return;
    focusFirstInvalid(fieldErrors, order, fieldLookup(formRef?.current));
    // `signature` resume el contenido de `fieldErrors` y el orden: alcanza como dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}

type FormErrorSummaryProps = {
  fieldErrors: FieldErrorMap | undefined;
  order?: readonly string[];
  labels?: Record<string, string>;
};

/** Resumen de errores con links a cada campo. Con un solo error no se dibuja (#242). */
export function FormErrorSummary({ fieldErrors, order = [], labels = {} }: FormErrorSummaryProps) {
  const entries = orderedFieldErrors(fieldErrors, order);

  if (entries.length < 2) {
    return null;
  }

  function enfocar(name: string) {
    focusFirstInvalid({ [name]: fieldErrors?.[name] ?? "" }, [name], fieldLookup(null));
  }

  return (
    <div className="form-alert error" role="alert" data-form-error-summary="">
      <p>Revisá estos {entries.length} campos:</p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.name}>
            <a
              href={`#${entry.name}`}
              onClick={(event) => {
                event.preventDefault();
                enfocar(entry.name);
              }}
            >
              {labels[entry.name] ?? FIELD_LABELS[entry.name] ?? entry.name}: {entry.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
