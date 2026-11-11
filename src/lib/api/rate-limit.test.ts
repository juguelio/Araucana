import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), executeRaw: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw } }));

import { consumirCupo, cuposDeAcceso, cuposDeReserva, ipDelPedido, limitarPedido, mensajeDeRafaga } from "./rate-limit";

const ip = "190.15.20.30";
const pedido = (cabeceras: Record<string, string> = { "x-forwarded-for": ip }) =>
  new Request("https://araucana.vercel.app/api/v1/reservations", { method: "POST", headers: cabeceras });

beforeEach(() => {
  mocks.queryRaw.mockReset();
  mocks.executeRaw.mockReset();
  mocks.executeRaw.mockResolvedValue(0);
});

describe("freno de pedidos por IP", () => {
  it("deja pasar mientras haya cupo y cuenta los que quedan", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ count: 1 }]);
    const resultado = await consumirCupo(`reserva-corta:${ip}`, cuposDeReserva[0]);
    expect(resultado).toMatchObject({ permitido: true, restantes: 5 });
  });

  it("frena al pasarse del cupo y dice cuánto falta para la ventana siguiente", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ count: 7 }]);
    const ahora = new Date("2026-11-11T12:04:00Z"); // ventana de 10 min que arranca 12:00
    const resultado = await consumirCupo(`reserva-corta:${ip}`, cuposDeReserva[0], ahora);
    expect(resultado.permitido).toBe(false);
    expect(resultado.esperarSegundos).toBe(360);
  });

  it("cada ventana arranca de cero: la clave guardada es la ventana truncada", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ count: 1 }]);
    await consumirCupo(`reserva-corta:${ip}`, cuposDeReserva[0], new Date("2026-11-11T12:31:00Z"));
    const [textos, clave, inicio] = mocks.queryRaw.mock.calls[0];
    expect(clave).toBe(`reserva-corta:${ip}`);
    expect((inicio as Date).toISOString()).toBe("2026-11-11T12:30:00.000Z");
    expect(textos.join("?")).toContain("ON CONFLICT");
  });

  it("no frena si no hay IP confiable: preferimos no perder una venta", async () => {
    const respuesta = await limitarPedido(pedido({}), cuposDeReserva);
    expect(respuesta).toBeNull();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("toma la primera IP de x-forwarded-for y acepta x-real-ip", () => {
    expect(ipDelPedido(pedido({ "x-forwarded-for": "190.15.20.30, 10.0.0.1" }))).toBe(ip);
    expect(ipDelPedido(pedido({ "x-real-ip": "181.1.2.3" }))).toBe("181.1.2.3");
    expect(ipDelPedido(pedido({ "x-forwarded-for": "x".repeat(80) }))).toBeNull();
  });

  it("responde 429 con el mensaje y el tiempo de espera cuando la ráfaga se pasa", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ count: 7 }]);
    const respuesta = await limitarPedido(pedido(), cuposDeReserva);
    expect(respuesta?.status).toBe(429);
    expect(respuesta?.headers.get("Retry-After")).toBeTruthy();
    await expect(respuesta?.json()).resolves.toMatchObject({ error: { code: "TOO_MANY_REQUESTS", message: mensajeDeRafaga } });
  });

  it("deja pasar cuando está dentro de la ventana corta y de la hora", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ count: 2 }]).mockResolvedValueOnce([{ count: 5 }]);
    expect(await limitarPedido(pedido(), cuposDeReserva)).toBeNull();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("también cuenta la ráfaga larga aunque la corta tenga lugar", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ count: 3 }]).mockResolvedValueOnce([{ count: 21 }]);
    const respuesta = await limitarPedido(pedido(), cuposDeReserva);
    expect(respuesta?.status).toBe(429);
  });

  it("el acceso (login y registro) tiene su propio cupo", () => {
    expect(cuposDeAcceso.map((c) => c.nombre)).toEqual(["acceso-corta", "acceso-hora"]);
    expect(cuposDeAcceso[0].limite).toBeGreaterThan(cuposDeReserva[0].limite);
  });

  it("de vez en cuando limpia las ventanas viejas", async () => {
    const azar = vi.spyOn(Math, "random").mockReturnValue(0.001);
    mocks.queryRaw.mockResolvedValueOnce([{ count: 1 }]);
    await consumirCupo(`reserva-corta:${ip}`, cuposDeReserva[0]);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    azar.mockRestore();
  });

  it("no limpia en el pedido normal", async () => {
    const azar = vi.spyOn(Math, "random").mockReturnValue(0.5);
    mocks.queryRaw.mockResolvedValueOnce([{ count: 1 }]);
    await consumirCupo(`reserva-corta:${ip}`, cuposDeReserva[0]);
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    azar.mockRestore();
  });

  it("si la tabla no está o la base falla, deja pasar y avisa en los logs", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.queryRaw.mockRejectedValueOnce(new Error('relation "RateLimitHit" does not exist'));
    const resultado = await consumirCupo(`reserva-corta:${ip}`, cuposDeReserva[0]);
    expect(resultado.permitido).toBe(true);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});
