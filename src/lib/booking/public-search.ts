/**
 * Opciones del buscador público (home y /rutas).
 *
 * Los tramos de aeropuerto no son rutas por horario: se reservan por vuelo. Para que figuren
 * en el mismo selector sin mezclarse con los nombres de las ciudades, se marcan con un prefijo
 * y la página que recibe la búsqueda redirige al flujo de reserva por vuelo.
 */

export const AIRPORT_OPTION_PREFIX = "aeropuerto:";

export type SearchOption = { value: string; label: string };

type AirportLike = { slug: string; from: string; to: string };

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

export function airportOptionValue(slug: string) {
  return `${AIRPORT_OPTION_PREFIX}${slug}`;
}

/** Slug del tramo de aeropuerto elegido en el buscador, o null si el valor es una ruta por horario. */
export function airportSlugFromSelection(value: string | null | undefined): string | null {
  const selection = value?.trim() ?? "";
  if (!selection.startsWith(AIRPORT_OPTION_PREFIX)) {
    return null;
  }

  const slug = selection.slice(AIRPORT_OPTION_PREFIX.length).trim();
  return SLUG_PATTERN.test(slug) ? slug : null;
}

/** Un tramo de aeropuerto por sentido, con el par origen → destino como etiqueta. */
export function airportOptions(routes: readonly AirportLike[]): SearchOption[] {
  const seen = new Set<string>();
  const options: SearchOption[] = [];

  for (const route of routes) {
    if (!route.slug || seen.has(route.slug)) {
      continue;
    }

    seen.add(route.slug);
    options.push({ value: airportOptionValue(route.slug), label: `${route.from} → ${route.to}` });
  }

  return options;
}

/** Nombres de las rutas por horario: sin vacíos, sin repetidos y en el orden recibido. */
export function routeOptions(values: readonly string[]): SearchOption[] {
  const seen = new Set<string>();
  const options: SearchOption[] = [];

  for (const value of values) {
    const label = value.trim();
    if (!label || seen.has(label)) {
      continue;
    }

    seen.add(label);
    options.push({ value: label, label });
  }

  return options;
}

/**
 * Opciones completas del buscador: los tramos de aeropuerto van primero para que en el celular
 * aparezcan sin tener que bajar hasta la sección del aeropuerto.
 */
export function searchOptions(values: readonly string[], airportRoutes: readonly AirportLike[]): SearchOption[] {
  return [...airportOptions(airportRoutes), ...routeOptions(values)];
}
