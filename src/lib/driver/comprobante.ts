import { createHmac, timingSafeEqual } from "node:crypto";
import type { ServicioApp } from "./jornada-app-types";

type HojaEmitida = {
  driverId: string;
  servicioId: string;
  fecha: string;
  titulo: string;
  vehicleId: string | null;
  nave: string | null;
  salida: string | null;
  fin: string | null;
  filas: { id: string; nombre: string; cantidad: number }[];
};

function firma(payload: string) {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("Falta configurar AUTH_JWT_SECRET.");
  return createHmac("sha256", secret).update("jornada-chofer:v1:").update(payload).digest();
}

// Comprobante de procedencia para conciliar trabajo sin conexión. No concede acceso a una hoja.
export function firmarServicio(driverId: string, s: ServicioApp) {
  const hoja: HojaEmitida = {
    driverId, servicioId: s.id, fecha: s.fecha, titulo: s.titulo, vehicleId: s.nave?.id ?? null,
    nave: s.nave?.nombre ?? null, salida: s.salida, fin: s.fin,
    filas: s.filas.map(({ id, nombre, cantidad }) => ({ id, nombre, cantidad }))
  };
  const payload = Buffer.from(JSON.stringify(hoja)).toString("base64url");
  return payload + "." + firma(payload).toString("base64url");
}

export function leerComprobante(token: string, driverId: string): HojaEmitida | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = firma(parts[0]);
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) return null;
  const hoja: HojaEmitida = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  return hoja.driverId === driverId ? hoja : null;
}
