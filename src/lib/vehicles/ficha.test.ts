import { describe, expect, it } from "vitest";
import {
  contarPorArea,
  filtrarRecorridos,
  historialDePapeles,
  leerAreaDeRecorrido,
  leerDanio,
  leerFiltroDeRecorridos,
  recorridosDeNave,
  resumenDeDanios,
  valorDePapel,
  type FuentesDeRecorridos
} from "./ficha";

const ruta = { from: "San Martín de los Andes", to: "Bariloche" };

function fuentes(parcial: Partial<FuentesDeRecorridos> = {}): FuentesDeRecorridos {
  return { salidas: [], unidadesExtra: [], viajesEspeciales: [], aeropuerto: [], chapelco: [], ...parcial };
}

describe("recorridosDeNave", () => {
  it("junta las cuatro áreas en una sola línea de tiempo, de la más nueva a la más vieja", () => {
    const lista = recorridosDeNave(
      fuentes({
        salidas: [
          {
            id: "s1", routeId: "r1", status: "OPEN", route: ruta, driver: { name: "Ana" },
            departureAt: new Date("2026-11-10T10:00:00Z"), arrivalAt: new Date("2026-11-10T14:00:00Z"), _count: { reservations: 1 }
          }
        ],
        unidadesExtra: [
          {
            id: "u1", driver: null,
            schedule: { id: "s2", routeId: "r1", status: "OPEN", route: ruta, departureAt: new Date("2026-11-12T10:00:00Z"), arrivalAt: new Date("2026-11-12T14:00:00Z") }
          }
        ],
        viajesEspeciales: [
          {
            id: "v1", startsAt: new Date("2026-11-15T08:00:00Z"), endsAt: new Date("2026-11-15T20:00:00Z"), driver: { name: null, email: "chofer@x.test" },
            trip: { id: "t1", client: "Colegio Nacional", status: "CONFIRMED", passengers: 40 }
          }
        ],
        aeropuerto: [
          {
            id: "a1", driver: { name: "Beto" },
            flight: { id: "f1", number: "AR1672", airline: "Aerolíneas", origin: "Aeroparque", destination: "CPC", direction: "ARRIVAL", scheduledAt: new Date("2026-11-11T16:00:00Z"), status: "LANDED" }
          }
        ],
        chapelco: [
          { id: "c1", status: "ACTIVE", capacity: 19, operationDay: { serviceDate: new Date("2026-11-09T00:00:00Z"), route: null }, _count: { runs: 3 } }
        ]
      })
    );

    expect(lista.map((r) => r.key)).toEqual(["VIAJE_ESPECIAL:v1", "SALIDA_EXTRA:u1", "AEROPUERTO:a1", "SALIDA:s1", "CHAPELCO:c1"]);
    const [viaje, extra, vuelo, salida, chapelco] = lista;
    expect(viaje).toMatchObject({ titulo: "Colegio Nacional", detalle: "40 pasajeros", chofer: "chofer@x.test", estado: "Confirmado", href: "/admin/viajes-especiales/t1" });
    expect(extra).toMatchObject({ area: "SALIDA", detalle: "Unidad adicional de la salida", chofer: null, href: "/admin/rutas/r1/salidas/s2" });
    expect(vuelo).toMatchObject({ titulo: "Arribo vuelo AR1672 (Aerolíneas)", detalle: "Desde Aeroparque", estado: "Aterrizó", href: "/admin/aeropuerto?date=2026-11-11" });
    expect(salida).toMatchObject({ titulo: "San Martín de los Andes → Bariloche", detalle: "Nave principal · 1 reserva", chofer: "Ana", estado: "Abierta" });
    expect(chapelco).toMatchObject({ titulo: "Traslados al cerro", detalle: "19 lugares · 3 vueltas", href: "/admin/chapelco?date=2026-11-09" });
    expect(contarPorArea(lista)).toEqual({ SALIDA: 2, VIAJE_ESPECIAL: 1, AEROPUERTO: 1, CHAPELCO: 1 });
  });
});

describe("link del aeropuerto", () => {
  it("usa el día de Argentina: un vuelo de las 22 h no salta al día siguiente", () => {
    const [vuelo] = recorridosDeNave(
      fuentes({
        aeropuerto: [
          { id: "a", flight: { id: "f", number: "1", airline: null, origin: "A", destination: "B", direction: "DEPARTURE", scheduledAt: new Date("2026-11-12T01:00:00Z") } }
        ]
      })
    );
    expect(vuelo.href).toBe("/admin/aeropuerto?date=2026-11-11");
  });
});

describe("filtrarRecorridos", () => {
  const ahora = new Date("2026-11-12T12:00:00Z");
  const lista = recorridosDeNave(
    fuentes({
      salidas: [
        { id: "pasada", routeId: "r", status: "OPEN", route: ruta, departureAt: new Date("2026-11-10T10:00:00Z"), arrivalAt: new Date("2026-11-10T14:00:00Z") },
        { id: "en-curso", routeId: "r", status: "OPEN", route: ruta, departureAt: new Date("2026-11-12T10:00:00Z"), arrivalAt: new Date("2026-11-12T14:00:00Z") },
        { id: "lejana", routeId: "r", status: "OPEN", route: ruta, departureAt: new Date("2026-12-01T10:00:00Z"), arrivalAt: new Date("2026-12-01T14:00:00Z") },
        { id: "cercana", routeId: "r", status: "OPEN", route: ruta, departureAt: new Date("2026-11-20T10:00:00Z"), arrivalAt: new Date("2026-11-20T14:00:00Z") }
      ],
      aeropuerto: [
        { id: "a", flight: { id: "f", number: "1", airline: null, origin: "A", destination: "B", direction: "DEPARTURE", scheduledAt: new Date("2026-11-21T10:00:00Z") } }
      ]
    })
  );

  it("los próximos van del más cercano al más lejano e incluyen el que está en curso", () => {
    expect(filtrarRecorridos(lista, "proximos", null, ahora).map((r) => r.key)).toEqual([
      "SALIDA:en-curso", "SALIDA:cercana", "AEROPUERTO:a", "SALIDA:lejana"
    ]);
  });

  it("los pasados quedan del más nuevo al más viejo y se puede filtrar por área", () => {
    expect(filtrarRecorridos(lista, "pasados", null, ahora).map((r) => r.key)).toEqual(["SALIDA:pasada"]);
    expect(filtrarRecorridos(lista, "todos", "AEROPUERTO", ahora).map((r) => r.key)).toEqual(["AEROPUERTO:a"]);
  });

  it("lee filtros de la URL y descarta lo que no reconoce", () => {
    expect(leerFiltroDeRecorridos("proximos")).toBe("proximos");
    expect(leerFiltroDeRecorridos("cualquiera")).toBe("todos");
    expect(leerAreaDeRecorrido("CHAPELCO")).toBe("CHAPELCO");
    expect(leerAreaDeRecorrido("toString")).toBe(null);
    expect(leerAreaDeRecorrido(undefined)).toBe(null);
  });
});

describe("historialDePapeles", () => {
  it("saca de la auditoría sólo los cambios de vencimientos, aseguradora y habilitación", () => {
    const cambios = historialDePapeles([
      {
        id: "log1", createdAt: new Date("2026-10-01T12:00:00Z"), actorName: "Ivan",
        changes: { name: { before: "A", after: "B" }, policyDueAt: { before: null, after: "2027-03-01T15:00:00.000Z" } }
      },
      {
        id: "log2", createdAt: new Date("2026-11-01T12:00:00Z"), actorName: null, actorEmail: "admin@x.test",
        changes: { rtoDueAt: { before: "2026-11-01T15:00:00.000Z", after: "2027-11-01T15:00:00.000Z" }, publicTransport: { before: false, after: true } }
      },
      { id: "log3", createdAt: new Date("2026-11-02T12:00:00Z"), actorName: "X", changes: null }
    ]);

    expect(cambios.map((c) => [c.campo, c.quien])).toEqual([
      ["publicTransport", "admin@x.test"],
      ["rtoDueAt", "admin@x.test"],
      ["policyDueAt", "Ivan"]
    ]);
    expect(valorDePapel("rtoDueAt", cambios[1].antes)).toBe("01/11/2026");
    expect(valorDePapel("policyDueAt", cambios[2].antes)).toBe("sin dato");
    expect(valorDePapel("publicTransport", cambios[0].despues)).toBe("Sí");
  });
});

describe("daños", () => {
  it("valida el formulario y guarda la fecha al mediodía de Argentina", () => {
    const leido = leerDanio({ occurredAt: "2026-11-18", description: "  Rayón puerta lateral ", severity: "MODERADO", reportedBy: "" });
    expect(leido).toEqual({
      ok: true,
      data: { occurredAt: new Date("2026-11-18T15:00:00.000Z"), description: "Rayón puerta lateral", severity: "MODERADO", reportedBy: null, notes: null }
    });
    const malo = leerDanio({ occurredAt: "18/11", description: " ", severity: "TOTAL" });
    expect(malo.ok).toBe(false);
    if (!malo.ok) expect(Object.keys(malo.errores).sort()).toEqual(["description", "occurredAt", "severity"]);
  });

  it("resume los daños abiertos y los graves", () => {
    expect(
      resumenDeDanios([
        { status: "PENDIENTE", severity: "GRAVE" },
        { status: "EN_REPARACION", severity: "LEVE" },
        { status: "REPARADO", severity: "GRAVE" }
      ])
    ).toEqual({ total: 3, abiertos: 2, graves: 1 });
  });
});
