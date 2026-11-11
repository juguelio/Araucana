import type { DepartureSheetKind } from "./types";

/**
 * Qué planilla le toca a una reserva según a dónde va el viaje.
 *
 * El cliente pide dos cosas distintas, y no son intercambiables: salir del **país** pide el DUT
 * (Documento Universal de Transporte, CNRT) y salir de la **provincia** pide el Registro de salida
 * de pasajeros, con una habilitación puntual. Una reserva que no sale de Neuquén no lleva ninguna
 * de las dos: ofrecer el link en todas las reservas termina en planillas vacías dando vueltas.
 *
 * `TravelRoute.to` es texto libre y el modelo no guarda provincia ni país del destino, así que se
 * resuelve con este nomenclador de localidades. Si aparece un destino nuevo, se agrega acá. El
 * default es «no lleva planilla»: preferimos que el operador la pida a mandar una planilla de un
 * viaje que no la necesita.
 */

/** Destinos del otro lado de la cordillera: cruzar la frontera es DUT. */
const CHILE = [
  "chile",
  "pucon",
  "villarrica",
  "temuco",
  "valdivia",
  "osorno",
  "puerto montt",
  "puerto varas",
  "frutillar",
  "panguipulli",
  "lican ray",
  "conaripe",
  "curarrehue",
  "chiloe",
  "castro",
  "ancud",
  "chaiten",
  "futaleufu",
  "palena",
  "hornopiren",
  "coihaique",
  "coyhaique",
  "punta arenas",
  "santiago de chile",
  "vina del mar",
  "valparaiso",
  "la serena",
  "iquique",
  "calama",
  "san pedro de atacama",
  "termas de chillan",
  "paso samore",
  "paso cardenal samore"
];

/** Localidades de Neuquén: el viaje no sale de la provincia, no lleva planilla. */
const NEUQUEN = [
  "san martin de los andes",
  "junin de los andes",
  "villa la angostura",
  "villa traful",
  "traful",
  "hua hum",
  "chapelco",
  "aeropuerto chapelco",
  "lolog",
  "meliquina",
  "villa pehuenia",
  "zapala",
  "neuquen",
  "caviahue",
  "copahue",
  "alumine",
  "chos malal",
  "las ovejas",
  "andacollo",
  "barrancas",
  "buta ranquil",
  "rincon de los sauces",
  "anelo",
  "cutral co",
  "plaza huincul",
  "picun leufu",
  "piedra del aguila",
  "villa el chocon",
  "senillosa",
  "plottier",
  "centenario",
  "san patricio del chanar",
  "huinganco",
  "quilaquina",
  "lacar"
];

/** Destinos del resto del país: sale de la provincia pero no del país → Registro de salida. */
const OTRAS_PROVINCIAS = [
  "bariloche",
  "dina huapi",
  "el bolson",
  "cipolletti",
  "general roca",
  "allen",
  "cinco saltos",
  "villa regina",
  "choele choel",
  "viedma",
  "las grutas",
  "san antonio oeste",
  "sierra grande",
  "playa union",
  "trelew",
  "puerto madryn",
  "esquel",
  "comodoro rivadavia",
  "perito moreno",
  "caleta olivia",
  "rio gallegos",
  "el calafate",
  "el chalten",
  "ushuaia",
  "rio grande",
  "buenos aires",
  "caba",
  "capital federal",
  "la plata",
  "mar del plata",
  "bahia blanca",
  "cordoba",
  "villa carlos paz",
  "rosario",
  "santa fe",
  "parana",
  "mendoza",
  "san juan",
  "san luis",
  "merlo",
  "salta",
  "cafayate",
  "jujuy",
  "tucuman",
  "catamarca",
  "la rioja",
  "santiago del estero",
  "corrientes",
  "posadas",
  "iguazu",
  "resistencia",
  "formosa",
  "puerto iguazu"
];

/** Texto del destino tal como lo escribe el operador: minúsculas y sin tildes. */
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matches(text: string, place: string) {
  return place.length > 2 && text.includes(place);
}

function hitsAny(texts: string[], places: string[]) {
  return texts.some((text) => places.some((place) => matches(text, place)));
}

export type PlanillaTripLeg = {
  /** `AR`, `AR_CL` en el tramo que cruza a Chile, etc. */
  country?: string | null;
  origin?: string | null;
  destination?: string | null;
  description?: string | null;
  stops?: string | null;
};

export type PlanillaTripInfo = {
  destinationSearch?: string | null;
  legs?: PlanillaTripLeg[] | null;
};

/** `legs` es un Json en la base: se lee defensivamente antes de decidir. */
export function parseTripLegs(value: unknown): PlanillaTripLeg[] {
  return Array.isArray(value) ? (value as PlanillaTripLeg[]) : [];
}

/**
 * Planillas que corresponden al viaje especial. Devuelve `[]` cuando no sale de la provincia.
 *
 * El itinerario ya trae el país por tramo (`legs[].country`: `AR`, `AR_CL`…), así que ése manda; el
 * texto del destino se usa para distinguir una salida a otra provincia de un viaje local.
 */
export function planillaKindsForSpecialTrip(trip: PlanillaTripInfo): DepartureSheetKind[] {
  const legs = trip.legs ?? [];

  // El país del tramo es el dato más confiable: `AR_CL` es el cruce a Chile.
  if (legs.some((leg) => /CL|CHILE/i.test(String(leg.country ?? "")))) {
    return ["DUT"];
  }

  const texts = [
    ...legs.flatMap((leg) => [leg.destination, leg.description, leg.stops]),
    trip.destinationSearch
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(normalize);

  if (texts.length === 0) {
    return [];
  }

  // Sin país cargado, el destino puede delatarlo igual.
  if (hitsAny(texts, CHILE)) {
    return ["DUT"];
  }

  // Neuquén se chequea antes que el resto del país: «Villa La Angostura» no es una provincia.
  if (hitsAny(texts, NEUQUEN)) {
    return [];
  }

  if (hitsAny(texts, OTRAS_PROVINCIAS)) {
    return ["PROVINCIA"];
  }

  return [];
}

/** Mensaje corto para el panel cuando el viaje no lleva planilla. */
export const planillaNotApplicableReason = "Este viaje no sale de la provincia: no necesita planilla.";
