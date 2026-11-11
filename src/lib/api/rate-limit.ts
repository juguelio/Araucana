import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export type CupoDePedidos = {
  /** Prefijo de la clave en la base: distingue reservas de intentos de acceso. */
  nombre: string;
  limite: number;
  ventanaSegundos: number;
};

/**
 * Cuánto tolera una misma IP. Una reserva web normal es un pedido cada varios minutos;
 * seis en diez minutos ya es un humano apurado o un script, y veinte por hora es el techo
 * razonable para una familia que reserva para todo el grupo.
 */
export const cuposDeReserva: CupoDePedidos[] = [
  { nombre: "reserva-corta", limite: 6, ventanaSegundos: 600 },
  { nombre: "reserva-hora", limite: 20, ventanaSegundos: 3600 }
];

export const cuposDeAcceso: CupoDePedidos[] = [
  { nombre: "acceso-corta", limite: 10, ventanaSegundos: 600 },
  { nombre: "acceso-hora", limite: 30, ventanaSegundos: 3600 }
];

export const mensajeDeRafaga =
  "Recibimos varios pedidos seguidos desde este dispositivo. Esperá unos minutos y volvé a intentar, o escribinos por WhatsApp y lo hacemos juntos.";

/** IP del pedido según el proxy de Vercel. Sin IP confiable no frenamos: preferimos no perder una venta. */
export function ipDelPedido(request: Request) {
  const reenviado = request.headers.get("x-forwarded-for");
  const candidata = reenviado?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "";
  return candidata && candidata.length <= 64 ? candidata : null;
}

export type ResultadoCupo = { permitido: boolean; restantes: number; esperarSegundos: number };

/**
 * Suma un pedido en la ventana actual y dice si todavía está dentro del cupo.
 * El incremento y la lectura van en una sola sentencia (INSERT ... ON CONFLICT ... RETURNING):
 * con varias instancias de Vercel atendiendo a la vez, contar en memoria no serviría.
 */
export async function consumirCupo(clave: string, cupo: CupoDePedidos, ahora = new Date()): Promise<ResultadoCupo> {
  const ventanaMs = cupo.ventanaSegundos * 1000;
  const inicio = new Date(Math.floor(ahora.getTime() / ventanaMs) * ventanaMs);

  try {
    const filas = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitHit" ("key", "windowStart", "count")
      VALUES (${clave}, ${inicio}, 1)
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitHit"."count" + 1
      RETURNING "count"
    `;
    const usados = Number(filas[0]?.count ?? 1);

    // Una de cada cien veces, tirar las ventanas viejas: sin esto la tabla crece para siempre.
    if (Math.random() < 0.01) {
      void prisma
        .$executeRaw`DELETE FROM "RateLimitHit" WHERE "windowStart" < ${new Date(ahora.getTime() - 2 * 24 * 3600 * 1000)}`
        .catch(() => undefined);
    }

    if (usados > cupo.limite) {
      const esperar = Math.ceil((inicio.getTime() + ventanaMs - ahora.getTime()) / 1000);
      return { permitido: false, restantes: 0, esperarSegundos: Math.max(esperar, 1) };
    }

    return { permitido: true, restantes: Math.max(cupo.limite - usados, 0), esperarSegundos: 0 };
  } catch (error) {
    // Sin tabla (migración sin aplicar) o base caída no bloqueamos: una venta perdida cuesta más
    // que una ráfaga sin frenar, y queda el aviso en los logs.
    console.warn("limite_de_pedidos_no_disponible", JSON.stringify({ clave, motivo: String(error).slice(0, 200) }));
    return { permitido: true, restantes: cupo.limite, esperarSegundos: 0 };
  }
}

/** Devuelve la respuesta 429 si la IP se pasó de alguno de los cupos, o null si puede seguir. */
export async function limitarPedido(request: Request, cupos: CupoDePedidos[]): Promise<Response | null> {
  const ip = ipDelPedido(request);
  if (!ip) return null;

  // Se suman todos los cupos aunque uno ya haya frenado: el contador de la hora tiene que
  // reflejar lo que realmente pasó, no sólo lo que llegó a la ventana corta.
  let bloqueo: ResultadoCupo | null = null;

  for (const cupo of cupos) {
    const resultado = await consumirCupo(`${cupo.nombre}:${ip}`, cupo);
    if (!resultado.permitido && !bloqueo) bloqueo = resultado;
  }

  if (bloqueo) {
    return NextResponse.json(
      { error: { code: "TOO_MANY_REQUESTS", message: mensajeDeRafaga } },
      { status: 429, headers: { "Retry-After": String(bloqueo.esperarSegundos), "Cache-Control": "private, no-store" } }
    );
  }

  return null;
}
