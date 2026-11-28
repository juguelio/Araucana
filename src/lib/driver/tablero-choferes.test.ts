import { describe, expect, it } from "vitest";
import {
  bloqueEnLinea, carriles, limitesDeLinea, posicionDeAhora, enCurso, entraEnPestanaChoferes, horasDeLaJornada, iniciales, jornadaDe, leerPestanaChoferes,
  navesDeLaJornada, preseleccion, proximo, serviciosDeLaNave, type ServicioDelDia
} from "./tablero-choferes";

const DIA = "2026-11-28";
const a = (hhmm: string) => new Date(`${DIA}T${hhmm}:00-03:00`);

const servicio = (clave: string, vehicleId: string, driverId: string | null, desde: string, hasta: string, extra: Partial<ServicioDelDia> = {}): ServicioDelDia => ({
  clave, area: "SERVICIO_PUBLICO", vehicleId, driverId, desde: a(desde), hasta: a(hasta), titulo: clave, href: "#", asignableDesdeChoferes: true, ...extra
});

const dia: ServicioDelDia[] = [
  servicio("salida:tarde", "243", null, "15:45", "17:30"),
  servicio("salida:manana", "243", null, "10:00", "11:45"),
  servicio("vuelo:ar1659", "243", "laura", "18:30", "20:00", { area: "AEROPUERTO" }),
  servicio("salida:otra", "196", "ramon", "08:00", "09:30"),
  servicio("chapelco:t1", "152", "ramon", "08:00", "18:00", { area: "CHAPELCO", asignableDesdeChoferes: false })
];

describe("jornada de un chofer", () => {
  it("junta lo que maneja ese día, por hora, y las naves en el orden en que las usa", () => {
    const jornada = jornadaDe("ramon", dia);
    expect(jornada.map((s) => s.clave)).toEqual(["chapelco:t1", "salida:otra"]);
    expect(navesDeLaJornada(jornada)).toEqual(["152", "196"]);
  });

  it("un chofer sin servicios tiene la jornada vacía", () => {
    expect(jornadaDe("hernan", dia)).toEqual([]);
    expect(horasDeLaJornada([])).toBe(0);
  });

  it("las horas no cuentan dos veces lo que se superpone", () => {
    expect(horasDeLaJornada(jornadaDe("ramon", dia))).toBe(10); // 08–18 cubre 08–09:30
    expect(horasDeLaJornada([servicio("x", "1", "r", "08:00", "09:00"), servicio("y", "1", "r", "10:00", "10:30")])).toBe(1.5);
  });

  it("en curso y próximo según la hora", () => {
    const jornada = jornadaDe("laura", dia).concat(servicio("salida:z", "1", "laura", "09:00", "10:00")).sort((x, y) => +x.desde - +y.desde);
    expect(enCurso(jornada, a("09:30"))?.clave).toBe("salida:z");
    expect(proximo(jornada, a("09:30"))?.clave).toBe("vuelo:ar1659");
    expect(enCurso(jornada, a("12:00"))).toBeNull();
    expect(proximo(jornada, a("21:00"))).toBeNull();
  });
});

describe("asignar una nave a un chofer por el día", () => {
  it("trae los servicios de la nave ese día, por hora", () => {
    expect(serviciosDeLaNave("243", dia).map((s) => s.clave)).toEqual(["salida:manana", "salida:tarde", "vuelo:ar1659"]);
  });

  it("viene tildado lo que no tiene chofer o ya es suyo; lo de otro chofer, no", () => {
    const [manana, tarde, vuelo] = serviciosDeLaNave("243", dia);
    expect(preseleccion(manana, "ramon")).toBe(true);
    expect(preseleccion(tarde, "ramon")).toBe(true);
    expect(preseleccion(vuelo, "ramon")).toBe(false);
    expect(preseleccion(vuelo, "laura")).toBe(true);
  });

  it("Chapelco nunca viene tildado: se asigna desde su tablero", () => {
    const chapelco = dia.find((s) => s.area === "CHAPELCO")!;
    expect(preseleccion(chapelco, "ramon")).toBe(false);
    expect(preseleccion({ ...chapelco, driverId: null }, "ramon")).toBe(false);
  });
});

describe("línea del día (05 a 24 h)", () => {
  it("ubica cada servicio en porcentaje", () => {
    const bloque = bloqueEnLinea({ desde: a("05:00"), hasta: a("14:30") }, DIA)!;
    expect(bloque.izquierda).toBe(0);
    expect(bloque.ancho).toBeCloseTo(50);
  });

  it("un servicio de 00 a 24 ocupa toda la línea", () => {
    const bloque = bloqueEnLinea({ desde: a("00:00"), hasta: new Date(new Date(`${DIA}T00:00:00-03:00`).getTime() + 86_400_000) }, DIA)!;
    expect(bloque.izquierda).toBe(0);
    expect(bloque.ancho).toBeGreaterThan(99);
  });

  it("corta lo que empezó antes o termina después del día, y descarta lo que queda afuera", () => {
    const madrugada = bloqueEnLinea({ desde: new Date(`2026-11-27T23:00:00-03:00`), hasta: a("06:00") }, DIA)!;
    expect(madrugada.izquierda).toBe(0);
    expect(madrugada.ancho).toBeCloseTo(100 / 19);
    expect(bloqueEnLinea({ desde: a("02:00"), hasta: a("04:00") }, DIA)).toBeNull();
    const noche = bloqueEnLinea({ desde: a("23:00"), hasta: new Date(`2026-11-29T02:00:00-03:00`) }, DIA)!;
    expect(noche.izquierda + noche.ancho).toBeCloseTo(100);
  });

  it("un servicio muy corto se ve igual (ancho mínimo)", () => {
    expect(bloqueEnLinea({ desde: a("10:00"), hasta: a("10:05") }, DIA)!.ancho).toBe(1.2);
  });
});

describe("pestañas y avatar", () => {
  const chofer = { isActive: true, servicios: 2, documentacionEnOrden: true };
  it("cada pestaña junta lo suyo", () => {
    expect(entraEnPestanaChoferes("trabajan", chofer)).toBe(true);
    expect(entraEnPestanaChoferes("libres", chofer)).toBe(false);
    expect(entraEnPestanaChoferes("libres", { ...chofer, servicios: 0 })).toBe(true);
    expect(entraEnPestanaChoferes("documentacion", { ...chofer, documentacionEnOrden: false })).toBe(true);
    expect(entraEnPestanaChoferes("documentacion", chofer)).toBe(false);
    expect(entraEnPestanaChoferes("todos", chofer)).toBe(true);
    expect(entraEnPestanaChoferes("todos", { ...chofer, isActive: false })).toBe(false);
    expect(entraEnPestanaChoferes("inactivos", { ...chofer, isActive: false })).toBe(true);
    expect(entraEnPestanaChoferes("trabajan", { ...chofer, isActive: false })).toBe(false);
  });

  it("una pestaña desconocida cae en «trabajan»", () => {
    expect(leerPestanaChoferes("x")).toBe("trabajan");
    expect(leerPestanaChoferes("libres")).toBe("libres");
  });

  it("iniciales del nombre o del email", () => {
    expect(iniciales("Ramón Paz", "r@x")).toBe("RP");
    expect(iniciales("Laura María Gómez", "l@x")).toBe("LG");
    expect(iniciales("Silvia", "s@x")).toBe("SI");
    expect(iniciales(null, "hernan@x")).toBe("H");
  });
});

describe("carriles de la línea", () => {
  it("lo que no se pisa va en un carril; lo que se pisa, en otro", () => {
    const { carril, total } = carriles([
      servicio("a", "1", "h", "10:00", "12:00"),
      servicio("b", "2", "h", "10:30", "11:00"),
      servicio("c", "1", "h", "12:00", "13:00")
    ]);
    expect(total).toBe(2);
    expect([carril.get("a"), carril.get("b"), carril.get("c")]).toEqual([0, 1, 0]);
    expect(carriles([]).total).toBe(1);
  });
});

describe("ahora en la línea", () => {
  const limites = limitesDeLinea(DIA);

  it("la línea va de 05:00 a 24:00 de Argentina", () => {
    expect(new Date(limites.inicio).toISOString()).toBe("2026-11-28T08:00:00.000Z");
    expect(new Date(limites.fin).toISOString()).toBe("2026-11-29T03:00:00.000Z");
  });

  it("ahora, en porcentaje con un decimal", () => {
    expect(posicionDeAhora(a("05:00").getTime(), limites)).toBe(0);
    expect(posicionDeAhora(a("14:30").getTime(), limites)).toBe(50);
    expect(posicionDeAhora(a("12:29").getTime(), limites)).toBe(39.4);
    expect(posicionDeAhora(limites.fin, limites)).toBe(100);
  });

  it("fuera de la línea no hay dónde marcarlo", () => {
    expect(posicionDeAhora(a("04:59").getTime(), limites)).toBeNull();
    expect(posicionDeAhora(limites.fin + 60_000, limites)).toBeNull();
  });
});
