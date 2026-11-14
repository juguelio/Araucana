import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Link público de la orden de servicio para el chofer (issue #118, parte 2).
 *
 * El chofer no tiene usuario en el panel, así que la hoja se comparte con un token **firmado en la URL**:
 * no hay tabla nueva ni migración, y no se puede cambiar la fecha ni el vuelo sin invalidar la firma.
 * El token no da acceso a nada más que a esa hoja de ese día.
 *
 * Formato: `<cuerpo>.<firma>`, las dos partes en base64url.
 *   cuerpo = {"date":"2026-11-13","flight":null,"exp":1763268000}
 *   firma  = HMAC-SHA256(secreto, "orden-servicio:" + cuerpo)
 */

/** Propósitos separados: un token de la orden del chofer no abre la planilla de excursiones (#110). */
export const PROPOSITO_ORDEN = "orden-servicio";
export const PROPOSITO_EXCURSION = "planilla-excursion";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ServiceOrderLinkPayload = {
  /** Día del servicio, `YYYY-MM-DD`. */
  date: string;
  /** `null` = la orden del día completo; si no, el id del vuelo. */
  flight: string | null;
  /** Vencimiento en segundos desde epoch. */
  exp: number;
};

function secreto() {
  const valor = process.env.AUTH_JWT_SECRET;
  if (!valor || valor.length < 32) {
    throw new Error("AUTH_JWT_SECRET debe tener al menos 32 bytes.");
  }
  return valor;
}

function firmar(cuerpo: string, proposito: string = PROPOSITO_ORDEN) {
  return createHmac("sha256", secreto()).update(`${proposito}:${cuerpo}`).digest("base64url");
}

/**
 * Cuándo vence el link: el final del día **siguiente** al servicio, en hora argentina (UTC−3).
 * El chofer lo abre el día del vuelo (y a veces a la madrugada por demoras), pero no queda vivo para
 * siempre.
 */
export function vencimientoDelLink(date: string) {
  const servicio = new Date(`${date}T00:00:00.000Z`);
  // 00:00 del día siguiente en Salta = 03:00Z de ese mismo día; +24 h para dar margen al día posterior.
  return Math.floor((servicio.getTime() + 2 * 24 * 60 * 60 * 1000) / 1000);
}

export function crearTokenDeOrden(payload: ServiceOrderLinkPayload, proposito: string = PROPOSITO_ORDEN) {
  const cuerpo = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${cuerpo}.${firmar(cuerpo, proposito)}`;
}

/** Devuelve el payload sólo si la firma es válida, no venció y la fecha tiene forma de fecha. */
export function leerTokenDeOrden(
  token: string,
  ahora: Date = new Date(),
  proposito: string = PROPOSITO_ORDEN
): ServiceOrderLinkPayload | null {
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [cuerpo, firmaRecibida] = partes;
  if (!cuerpo || !firmaRecibida) return null;

  const esperada = Buffer.from(firmar(cuerpo, proposito), "utf8");
  const recibida = Buffer.from(firmaRecibida, "utf8");
  // `timingSafeEqual` exige el mismo largo: si difiere, la firma ya es inválida.
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) {
    return null;
  }

  let payload: ServiceOrderLinkPayload;
  try {
    payload = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || typeof payload.date !== "string" || !DATE_PATTERN.test(payload.date)) return null;
  if (payload.flight !== null && typeof payload.flight !== "string") return null;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
  if (payload.exp <= Math.floor(ahora.getTime() / 1000)) return null;

  return { date: payload.date, flight: payload.flight, exp: payload.exp };
}

/**
 * La ruta interna de la orden pública, con el token del día ya firmado.
 *
 * Las dos puertas de la hoja (la pantalla del panel y el link del chofer) salen de acá, así que la
 * fecha y el vuelo del token son exactamente los que el operador está mirando: no se puede cambiar
 * uno sin que la firma deje de cerrar.
 */
export function rutaDeLaOrden(date: string, flight: string | null) {
  return `/orden/${crearTokenDeOrden({ date, flight, exp: vencimientoDelLink(date) })}`;
}

/** El link completo para el chofer, a partir del origen del request. */
export function linkDeLaOrden(origen: string, date: string, flight: string | null) {
  return `${origen.replace(/\/$/, "")}${rutaDeLaOrden(date, flight)}`;
}

/**
 * La planilla de excursiones del día (#110), con el mismo esquema de token que la orden del chofer.
 * Reusa el campo `flight` del payload para el id de la excursión cuando la planilla es de una sola.
 */
export function rutaDeLaPlanilla(date: string, excursion: string | null) {
  return `/planilla-excursion/${crearTokenDeOrden({ date, flight: excursion, exp: vencimientoDelLink(date) }, PROPOSITO_EXCURSION)}`;
}

export function linkDeLaPlanilla(origen: string, date: string, excursion: string | null) {
  return `${origen.replace(/\/$/, "")}${rutaDeLaPlanilla(date, excursion)}`;
}
