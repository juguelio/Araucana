import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { reagruparVuelos } from "./pickup-group";

/** Una base en memoria con lo justo: vuelos con su grupo y el orden manual de las reservas. */
function base(vuelos: Record<string, string | null>) {
  const grupos = { ...vuelos };
  const limpiados: string[][] = [];
  const tx = {
    flight: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[]; not?: string }; pickupGroupId?: string | { in: string[] } } }) =>
        Object.entries(grupos)
          .filter(([id, grupo]) =>
            where.id?.in ? where.id.in.includes(id)
              : typeof where.pickupGroupId === "string" ? grupo === where.pickupGroupId
                : where.pickupGroupId ? grupo !== null && where.pickupGroupId.in.includes(grupo) : true)
          .map(([id, grupo]) => ({ id, pickupGroupId: grupo }))),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { pickupGroupId: string | null } }) => {
        where.id.in.forEach((id) => { grupos[id] = data.pickupGroupId; });
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { pickupGroupId: string | null } }) => { grupos[where.id] = data.pickupGroupId; })
    },
    airportReservationDetails: {
      updateMany: vi.fn(async ({ where }: { where: { flightId: { in: string[] } } }) => { limpiados.push([...where.flightId.in].sort()); })
    }
  } as unknown as Prisma.TransactionClient;
  return { tx, grupos, limpiados };
}

describe("reagruparVuelos: los vuelos de una misma camioneta", () => {
  it("junta dos vuelos en un grupo nuevo y borra el orden manual de sus recorridas", async () => {
    const { tx, grupos, limpiados } = base({ a: null, b: null, c: null });
    const resultado = await reagruparVuelos(tx, ["a", "b"], true);
    expect(resultado.cambio).toBe(true);
    expect(grupos.a).toBeTruthy();
    expect(grupos.a).toBe(grupos.b);
    expect(grupos.c).toBeNull();
    expect(limpiados).toEqual([["a", "b"]]);
  });

  it("volver a guardar el mismo grupo no cambia nada ni borra el orden manual", async () => {
    const { tx, limpiados } = base({ a: "g", b: "g" });
    expect(await reagruparVuelos(tx, ["b", "a"], true)).toEqual({ cambio: false, grupo: "g" });
    expect(limpiados).toEqual([]);
  });

  it("sacar un vuelo de un grupo de dos disuelve el grupo", async () => {
    const { tx, grupos } = base({ a: "g", b: "g" });
    await reagruparVuelos(tx, ["a"], true);
    expect(grupos).toEqual({ a: null, b: null });
  });

  it("separar un vuelo de un grupo de tres deja a los otros dos juntos", async () => {
    const { tx, grupos, limpiados } = base({ a: "g", b: "g", c: "g" });
    await reagruparVuelos(tx, ["c"], false);
    expect(grupos).toEqual({ a: "g", b: "g", c: null });
    expect(limpiados).toEqual([["a", "b", "c"]]);
  });

  it("mover un vuelo a otro grupo arma el nuevo y disuelve el viejo si queda solo", async () => {
    const { tx, grupos } = base({ a: "g", b: "g", c: null });
    await reagruparVuelos(tx, ["b", "c"], true);
    expect(grupos.a).toBeNull();
    expect(grupos.b).toBe(grupos.c);
    expect(grupos.b).not.toBe("g");
  });
});
