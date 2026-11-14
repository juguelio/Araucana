import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearTokenDeOrden, leerTokenDeOrden, linkDeLaOrden, vencimientoDelLink } from "./service-order-link";

const SECRETO = "secreto-de-prueba-con-mas-de-32-bytes-1234";

describe("link de la orden para el chofer (issue #118)", () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = SECRETO;
  });

  afterEach(() => {
    delete process.env.AUTH_JWT_SECRET;
  });

  const ahora = new Date("2026-11-13T12:00:00Z");

  it("un token recién creado se lee entero", () => {
    const token = crearTokenDeOrden({ date: "2026-11-13", flight: null, exp: vencimientoDelLink("2026-11-13") });
    const leido = leerTokenDeOrden(token, ahora);

    expect(leido).toEqual({ date: "2026-11-13", flight: null, exp: expect.any(Number) });
  });

  it("conserva el vuelo cuando la orden es de un solo vuelo", () => {
    const token = crearTokenDeOrden({ date: "2026-11-13", flight: "vuelo-1671", exp: vencimientoDelLink("2026-11-13") });

    expect(leerTokenDeOrden(token, ahora)?.flight).toBe("vuelo-1671");
  });

  it("rechaza un token manipulado: cambiar la fecha rompe la firma", () => {
    const token = crearTokenDeOrden({ date: "2026-11-13", flight: null, exp: vencimientoDelLink("2026-11-13") });
    const [cuerpo, firma] = token.split(".");
    const otroCuerpo = Buffer.from(JSON.stringify({ date: "2026-11-20", flight: null, exp: 9999999999 }), "utf8").toString("base64url");

    expect(leerTokenDeOrden(`${otroCuerpo}.${firma}`, ahora)).toBeNull();
    expect(cuerpo).not.toBe(otroCuerpo);
  });

  it("rechaza un token firmado con otro secreto", () => {
    const token = crearTokenDeOrden({ date: "2026-11-13", flight: null, exp: vencimientoDelLink("2026-11-13") });
    process.env.AUTH_JWT_SECRET = "otro-secreto-distinto-de-mas-de-32-bytes-99";

    expect(leerTokenDeOrden(token, ahora)).toBeNull();
  });

  it("rechaza un token vencido", () => {
    const vencido = crearTokenDeOrden({ date: "2026-11-13", flight: null, exp: Math.floor(ahora.getTime() / 1000) - 60 });

    expect(leerTokenDeOrden(vencido, ahora)).toBeNull();
  });

  it("el link vence después del día del servicio, no antes", () => {
    const vencimiento = vencimientoDelLink("2026-11-13");
    const servicio = new Date("2026-11-13T12:00:00Z");

    // Sigue sirviendo el mismo día del vuelo y el siguiente.
    expect(leerTokenDeOrden(crearTokenDeOrden({ date: "2026-11-13", flight: null, exp: vencimiento }), servicio)).not.toBeNull();
    expect(
      leerTokenDeOrden(crearTokenDeOrden({ date: "2026-11-13", flight: null, exp: vencimiento }), new Date("2026-11-14T23:00:00Z"))
    ).not.toBeNull();
    // Y ya no sirve dos días después.
    expect(
      leerTokenDeOrden(crearTokenDeOrden({ date: "2026-11-13", flight: null, exp: vencimiento }), new Date("2026-11-16T00:00:00Z"))
    ).toBeNull();
  });

  it("rechaza basura en el token sin explotar", () => {
    expect(leerTokenDeOrden("", ahora)).toBeNull();
    expect(leerTokenDeOrden("sin-punto", ahora)).toBeNull();
    expect(leerTokenDeOrden("a.b.c", ahora)).toBeNull();
    expect(leerTokenDeOrden("!!!.???", ahora)).toBeNull();
    const fechaRota = crearTokenDeOrden({ date: "13-11-2026", flight: null, exp: 9999999999 });
    expect(leerTokenDeOrden(fechaRota, ahora)).toBeNull();
  });

  it("arma el link con el origen del pedido y sin doble barra", () => {
    const link = linkDeLaOrden("https://araucana.vercel.app/", "2026-11-13", null);

    expect(link.startsWith("https://araucana.vercel.app/orden/")).toBe(true);
    const token = link.split("/orden/")[1];
    expect(leerTokenDeOrden(token, ahora)?.date).toBe("2026-11-13");
  });
});

describe("propósitos separados (issue #110)", () => {
  const ahora = new Date("2026-11-13T12:00:00Z");

  it("un token de la planilla de excursiones no abre la orden del chofer", async () => {
    process.env.AUTH_JWT_SECRET = "secreto-de-prueba-con-mas-de-32-bytes-1234";
    const { crearTokenDeOrden, leerTokenDeOrden, PROPOSITO_EXCURSION, PROPOSITO_ORDEN } = await import("./service-order-link");

    const tokenExcursion = crearTokenDeOrden({ date: "2026-11-13", flight: null, exp: 9999999999 }, PROPOSITO_EXCURSION);

    expect(leerTokenDeOrden(tokenExcursion, ahora, PROPOSITO_ORDEN)).toBeNull();
    expect(leerTokenDeOrden(tokenExcursion, ahora, PROPOSITO_EXCURSION)).not.toBeNull();
  });
});
