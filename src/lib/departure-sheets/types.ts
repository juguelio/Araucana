/**
 * Planillas de salida que pide la agencia antes de un viaje fuera de temporada local:
 *
 * - **DUT** — Documento Universal de Transporte (CNRT, `dut.cnrt.gob.ar`). Es la declaración
 *   jurada del viaje al exterior y contiene la Lista de Pasajeros: apellido, nombre, tipo y número
 *   de documento, sexo, fecha de nacimiento y nacionalidad.
 * - **Registro de salida de pasajeros** — la planilla de la provincia (Neuquén) para salir del
 *   territorio provincial con una habilitación puntual. Pide además ocupación y país de residencia.
 *
 * Los encabezados de `columns` son los de las planillas originales del cliente: el .xlsx que se
 * descarga del panel tiene que poder pegarse en su circuito administrativo sin reescribir títulos.
 */

export const departureSheetKinds = ["DUT", "PROVINCIA"] as const;

export type DepartureSheetKind = (typeof departureSheetKinds)[number];

export type DepartureSheetColumn = {
  header: string;
  /** `text` fuerza formato texto en Excel: un apellido que empieza con "=" no debe ser fórmula. */
  format: "text" | "date" | "int";
  value: (passenger: DepartureSheetPassengerRow) => string | number | Date;
};

/** Lo mínimo que necesita la planilla exportada; no depende de Prisma. */
export type DepartureSheetPassengerRow = {
  position: number;
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  sex: string;
  birthDate: Date;
  nationality: string;
  occupation?: string | null;
  residenceCountry?: string | null;
};

export const documentTypes = ["DNI", "PAS", "CI", "LC", "LE", "OTRO"] as const;

export type DocumentType = (typeof documentTypes)[number];

export const documentTypeLabels: Record<DocumentType, string> = {
  DNI: "DNI",
  PAS: "Pasaporte",
  CI: "Cédula de identidad",
  LC: "Libreta cívica",
  LE: "Libreta de enrolamiento",
  OTRO: "Otro documento"
};

export const sexOptions = ["F", "M", "X"] as const;

export type SexValue = (typeof sexOptions)[number];

export const sexLabels: Record<SexValue, string> = {
  F: "Femenino",
  M: "Masculino",
  X: "X (no binario)"
};

const isoDay = (value: Date) => value.toISOString().slice(0, 10);

const displayDay = (value: Date) => {
  const [year, month, day] = isoDay(value).split("-");
  return `${day}/${month}/${year}`;
};

const dutColumns: DepartureSheetColumn[] = [
  { header: "apellido", format: "text", value: (p) => p.lastName },
  { header: "nombre", format: "text", value: (p) => p.firstName },
  { header: "tipo_documento", format: "text", value: (p) => p.documentType },
  { header: "numero_documento", format: "text", value: (p) => p.documentNumber },
  { header: "sexo", format: "text", value: (p) => p.sex },
  { header: "fecha nac", format: "date", value: (p) => p.birthDate },
  { header: "nacionalidad", format: "text", value: (p) => p.nationality }
];

const provinciaColumns: DepartureSheetColumn[] = [
  { header: "Nº", format: "int", value: (p) => p.position },
  { header: "Apellido y Nombre", format: "text", value: (p) => `${p.lastName} ${p.firstName}`.trim() },
  { header: "Fecha de Nac", format: "date", value: (p) => p.birthDate },
  { header: "Nacionalidad", format: "text", value: (p) => p.nationality },
  { header: "Ocupación", format: "text", value: (p) => p.occupation ?? "" },
  { header: "Sexo", format: "text", value: (p) => p.sex },
  { header: "Tipo y Nº Documento", format: "text", value: (p) => `${p.documentType} ${p.documentNumber}` },
  { header: "País de Residen.", format: "text", value: (p) => p.residenceCountry ?? "" }
];

export const departureSheetCopy: Record<
  DepartureSheetKind,
  {
    label: string;
    shortLabel: string;
    worksheetName: string;
    columns: DepartureSheetColumn[];
    /** Qué se le explica al pasajero en el formulario público. */
    passengerIntro: string;
    /** Por qué se piden los datos, en una línea, para el pie del formulario. */
    passengerNote: string;
    /** Campos extra del registro provincial. */
    asksResidence: boolean;
  }
> = {
  DUT: {
    label: "Documento Universal de Transporte (DUT) — salida del país",
    shortLabel: "DUT",
    worksheetName: "DUT",
    columns: dutColumns,
    passengerIntro:
      "Estos datos van a la Lista de Pasajeros del DUT (Documento Universal de Transporte), que se presenta al cruzar la frontera.",
    passengerNote:
      "Copiá los datos tal como figuran en el documento de identidad: Migraciones los controla en el paso fronterizo.",
    asksResidence: false
  },
  PROVINCIA: {
    label: "Registro de salida de pasajeros — salida de la provincia",
    shortLabel: "Salida de la provincia",
    worksheetName: "Registro de salida",
    columns: provinciaColumns,
    passengerIntro:
      "Estos datos van al Registro de salida de pasajeros que se presenta para la habilitación del viaje fuera de la provincia.",
    passengerNote: "Copiá los datos tal como figuran en el documento de identidad.",
    asksResidence: true
  }
};

export function isDepartureSheetKind(value: string): value is DepartureSheetKind {
  return (departureSheetKinds as readonly string[]).includes(value);
}

export function departureSheetLabel(kind: string) {
  return isDepartureSheetKind(kind) ? departureSheetCopy[kind].label : "Planilla de salida";
}

export function departureSheetColumns(kind: string): DepartureSheetColumn[] {
  return isDepartureSheetKind(kind) ? departureSheetCopy[kind].columns : [];
}

export function formatBirthDate(value: Date) {
  return displayDay(value);
}

export function formatBirthDateIso(value: Date) {
  return isoDay(value);
}

export function passengerFullName(passenger: { firstName: string; lastName: string }) {
  return `${passenger.lastName}, ${passenger.firstName}`.replace(/^, /, "");
}
