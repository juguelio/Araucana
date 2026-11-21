/**
 * Lógica del viaje de «Nueva reserva» con el template del aeropuerto (pedido de Jugue, 18-nov), sin
 * React para poder testearla: qué lugares y destinos hay, qué salidas tiene un día, qué vuelta se
 * puede ofrecer y cuánto sale.
 */

import { corridorStops, segmentPrice } from "@/lib/booking/segment-fares";
import { fareCounts, reservationTotalCents } from "@/lib/booking/passenger-fares";
import { claveDeLugar } from "@/lib/booking/place-names";
import type { SalidaOption } from "./salida-picker-utils";

export type Lugar = { nombre: string; salidas: number };

/** Una ruta activa, tenga o no salidas cargadas (para listarla igual en Desde/Hacia). */
export type RutaDelPanel = { id: string; from: string; to: string; bookingMode?: string; currency?: string };

export function lugaresDeSalida(route: RutaDelPanel) {
  const stops = corridorStops(route);
  return stops.length ? stops.slice(0, -1) : [route.from];
}

function lugaresDeLlegada(route: RutaDelPanel, origen: string) {
  const stops = corridorStops(route);
  if (!stops.length) return origen === route.from ? [route.to] : [];
  const index = stops.indexOf(origen);
  return index < 0 ? [] : stops.slice(index + 1);
}

/**
 * Un solo nombre por lugar: «San Martin de los Andes» y «San Martín de los Andes» son el mismo (las
 * rutas del repo lo escriben sin tilde). Se muestra la forma con tildes si existe; si no, la más usada.
 */
export function unificarLugares(salidas: SalidaOption[], rutas: RutaDelPanel[] = []) {
  const variantes = new Map<string, Map<string, number>>();
  for (const nombre of [...salidas.flatMap((s) => [s.from, s.to]), ...rutas.flatMap((r) => [r.from, r.to])]) {
    const clave = claveDeLugar(nombre);
    const formas = variantes.get(clave) ?? new Map<string, number>();
    const limpio = nombre.trim().replace(/\s+/g, " ");
    formas.set(limpio, (formas.get(limpio) ?? 0) + 1);
    variantes.set(clave, formas);
  }
  const nombreDe = new Map<string, string>();
  for (const [clave, formas] of variantes) {
    const elegido = [...formas.entries()].sort(
      (a, b) => Number(/[^\x00-\x7f]/.test(b[0])) - Number(/[^\x00-\x7f]/.test(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0], "es")
    )[0][0];
    nombreDe.set(clave, elegido);
  }
  const nombre = (lugar: string) => nombreDe.get(claveDeLugar(lugar)) ?? lugar;
  return {
    salidas: salidas.map((salida) => ({ ...salida, from: nombre(salida.from), to: nombre(salida.to) })),
    rutas: rutas.map((ruta) => ({ ...ruta, from: nombre(ruta.from), to: nombre(ruta.to) }))
  };
}

/** Clave para ordenar y comparar salidas en el tiempo: el día y la hora de Argentina. */
export function momento(salida: Pick<SalidaOption, "dayKey" | "timeLabel">) {
  return `${salida.dayKey} ${salida.timeLabel}`;
}

function contar(nombres: string[], cabeceras = new Set<string>()): Lugar[] {
  const mapa = new Map<string, number>();
  for (const nombre of nombres) mapa.set(nombre, (mapa.get(nombre) ?? 0) + 1);
  // Primero los lugares con más salidas (los que más se usan), después por nombre.
  return [...mapa.entries()]
    .map(([nombre, salidas]) => ({ nombre, salidas }))
    .sort((a, b) => b.salidas - a.salidas || Number(cabeceras.has(b.nombre)) - Number(cabeceras.has(a.nombre)) || a.nombre.localeCompare(b.nombre, "es"));
}

/** Suma con 0 salidas los lugares de rutas activas que todavía no tienen salidas cargadas. */
function conRutasSinSalidas(lugares: Lugar[], nombres: string[]) {
  const vistos = new Set(lugares.map((lugar) => lugar.nombre));
  const faltan = [...new Set(nombres)].filter((nombre) => !vistos.has(nombre)).sort((a, b) => a.localeCompare(b, "es"));
  return [...lugares, ...faltan.map((nombre) => ({ nombre, salidas: 0 }))];
}

/** Desde dónde se puede salir (las rutas sin salidas cargadas, al final). */
export function origenes(salidas: SalidaOption[], rutas: RutaDelPanel[] = []) {
  return conRutasSinSalidas(contar(salidas.flatMap(lugaresDeSalida), new Set(salidas.map((s) => s.from))), rutas.flatMap(lugaresDeSalida));
}

/** Adónde se puede ir desde `origen` (las rutas sin salidas cargadas, al final). */
export function destinosDesde(salidas: SalidaOption[], origen: string, rutas: RutaDelPanel[] = []) {
  return conRutasSinSalidas(
    contar(salidas.flatMap((salida) => lugaresDeLlegada(salida, origen)), new Set(salidas.map((s) => s.to))),
    rutas.flatMap((ruta) => lugaresDeLlegada(ruta, origen))
  );
}

/** La ruta activa de `desde` a `hacia` (para ofrecer cargarle salidas si no tiene). */
export function rutaEntre(rutas: RutaDelPanel[], desde: string, hacia: string) {
  return rutas.find((ruta) => lugaresDeLlegada(ruta, desde).includes(hacia)) ?? null;
}

/** Las salidas de un tramo, en orden. */
export function salidasDelTramo(salidas: SalidaOption[], desde: string, hacia: string) {
  return salidas
    .flatMap((salida) => {
      if (!lugaresDeLlegada(salida, desde).includes(hacia)) return [];
      if (!corridorStops(salida).length) return [salida];
      const boardingStop = desde === salida.from ? undefined : desde;
      const dropoffStop = hacia === salida.to ? undefined : hacia;
      const priceCents = segmentPrice({ ...salida, stops: salida.stopFares, priceCents: salida.priceCents ?? 0 }, boardingStop, dropoffStop);
      return [{ ...salida, boardingStop, dropoffStop, priceCents, stopFares: [] }];
    })
    .sort((a, b) => momento(a).localeCompare(momento(b)));
}

/** Cuántas salidas tiene cada día (para la tira de días). */
export function conteoPorDia(salidas: SalidaOption[]) {
  const mapa = new Map<string, number>();
  for (const salida of salidas) mapa.set(salida.dayKey, (mapa.get(salida.dayKey) ?? 0) + 1);
  return mapa;
}

/**
 * Las salidas de la vuelta que sirven: la ruta inversa, después de la ida. Sin ida elegida, todas las
 * de la ruta inversa (se puede mirar antes de elegir).
 */
export function vueltasPosibles(salidas: SalidaOption[], origen: string, destino: string, ida?: SalidaOption | null) {
  const inversa = salidasDelTramo(salidas, destino, origen);
  return ida ? inversa.filter((salida) => momento(salida) > momento(ida)) : inversa;
}

/** El primer día con salidas desde `minimo` (o el primero de todos). */
export function primerDia(salidas: SalidaOption[], minimo = "") {
  return salidas.find((salida) => salida.dayKey >= minimo)?.dayKey ?? "";
}

/**
 * La tira del selector de día: **sólo los días que tienen servicio** (19-nov). Antes se mostraban
 * siete días de calendario y los que no tenían salidas aparecían apagados; ahora la tira salta
 * directo a los días con salidas, de siete en siete desde `inicio`.
 *
 * Devuelve también `base`, la posición en la lista completa, para que el componente sepa si puede
 * retroceder o avanzar.
 */
export function tiraConServicio(dias: string[], inicio: string, cuantos = 7) {
  if (!dias.length) return { dias: [] as string[], base: 0, hayAntes: false, hayDespues: false };
  const encontrado = dias.findIndex((dia) => dia >= inicio);
  const base = encontrado < 0 ? Math.max(0, dias.length - cuantos) : encontrado;
  return {
    dias: dias.slice(base, base + cuantos),
    base,
    hayAntes: base > 0,
    hayDespues: base + cuantos < dias.length
  };
}

/** Precio por persona de un tramo: el de la parada donde baja, o el de la salida. */
export function precioDelTramo(salida: SalidaOption, parada: string) {
  const tarifa = parada ? salida.stopFares?.find((fare) => fare.name === parada) : undefined;
  return tarifa?.priceCents ?? salida.priceCents ?? 0;
}

/** Total estimado del viaje (ida, y vuelta si hay), con los menores. */
export function totalDelViaje(
  tramos: Array<{ salida: SalidaOption; parada: string }>,
  pasajeros: { lugares: number; media: number; sinCargo: number }
) {
  const cuentas = fareCounts(pasajeros.lugares, pasajeros.media, pasajeros.sinCargo);
  return tramos.reduce((total, tramo) => total + reservationTotalCents(precioDelTramo(tramo.salida, tramo.parada), cuentas), 0);
}

/**
 * La agencia está en San Martín de los Andes: el viaje que se propone al abrir arranca ahí, aunque
 * otra ruta tenga más salidas cargadas (Villa Traful tenía 258 y se llevaba el «Desde»).
 */
const ORIGEN_DE_LA_AGENCIA = "san martin de los andes";

/**
 * El viaje que se propone al abrir: desde San Martín, al destino con más salidas, y su primer día.
 * Con un servicio elegido arriba (pantalla única, 19-nov), arranca en ese recorrido.
 */
export function viajeInicial(salidas: SalidaOption[], pedido?: { origen: string; destino: string } | null) {
  if (pedido?.origen && pedido.destino) {
    return { origen: pedido.origen, destino: pedido.destino, dia: primerDia(salidasDelTramo(salidas, pedido.origen, pedido.destino)) };
  }
  const lugares = origenes(salidas);
  const deLaAgencia = lugares.find((lugar) => claveDeLugar(lugar.nombre) === ORIGEN_DE_LA_AGENCIA);
  const origen = (deLaAgencia ?? lugares[0])?.nombre ?? "";
  const destino = destinosDesde(salidas, origen)[0]?.nombre ?? "";
  return { origen, destino, dia: primerDia(salidasDelTramo(salidas, origen, destino)) };
}

/** Un servicio del selector de arriba: un recorrido (ida, y vuelta si existe) entre dos lugares. */
export type ServicioDeRuta = {
  clave: string;
  titulo: string;
  detalle: string;
  origen: string;
  destino: string;
  salidas: number;
};

function enSlug(texto: string) {
  return claveDeLugar(texto).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Los servicios por salida para el selector de «Reservar» (pantalla única, pedido de Jugue, 19-nov):
 * uno por par de lugares (la ida y su vuelta son el mismo servicio). Se nombra por el lugar que no es
 * San Martín (la agencia): «Villa Traful», «Hua Hum»; si ninguno es San Martín, por el origen, con el
 * otro lugar como detalle («Villa La Angostura» · «⇄ Villa Traful»). Primero los de más salidas.
 */
export function serviciosDeRutas(salidas: SalidaOption[], rutas: RutaDelPanel[] = []): ServicioDeRuta[] {
  const pares = new Map<string, { a: string; b: string; salidas: number; porSentido: Map<string, number> }>();
  const sumar = (desde: string, hacia: string, cantidad: number) => {
    const [x, y] = [desde, hacia].sort((m, n) => claveDeLugar(m).localeCompare(claveDeLugar(n)));
    const clave = `${claveDeLugar(x)}~${claveDeLugar(y)}`;
    const par = pares.get(clave) ?? { a: x, b: y, salidas: 0, porSentido: new Map<string, number>() };
    par.salidas += cantidad;
    par.porSentido.set(`${desde}→${hacia}`, (par.porSentido.get(`${desde}→${hacia}`) ?? 0) + cantidad);
    pares.set(clave, par);
  };
  for (const salida of salidas) sumar(salida.from, salida.to, 1);
  for (const ruta of rutas) sumar(ruta.from, ruta.to, 0);

  const usados = new Set<string>();
  return [...pares.values()]
    .sort((m, n) => n.salidas - m.salidas || m.a.localeCompare(n.a, "es"))
    .map((par) => {
      const esAgencia = (lugar: string) => claveDeLugar(lugar) === ORIGEN_DE_LA_AGENCIA;
      let origen: string;
      let destino: string;
      if (esAgencia(par.a) || esAgencia(par.b)) {
        origen = esAgencia(par.a) ? par.a : par.b;
        destino = esAgencia(par.a) ? par.b : par.a;
      } else {
        // Sin San Martín: arranca por el sentido con más salidas.
        const ida = par.porSentido.get(`${par.a}→${par.b}`) ?? 0;
        const vuelta = par.porSentido.get(`${par.b}→${par.a}`) ?? 0;
        [origen, destino] = vuelta > ida ? [par.b, par.a] : [par.a, par.b];
      }
      const conAgencia = esAgencia(origen);
      const titulo = conAgencia ? destino : origen;
      let clave = enSlug(titulo);
      if (usados.has(clave)) clave = `${clave}-${enSlug(conAgencia ? origen : destino)}`;
      usados.add(clave);
      return {
        clave,
        titulo,
        detalle: conAgencia ? `desde ${origen}` : `⇄ ${destino}`,
        origen,
        destino,
        salidas: par.salidas
      };
    });
}
