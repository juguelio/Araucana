import { describe, expect, it } from "vitest";
import { PAIHUEN_POINT, PAIHUEN_RADIUS_M, distanciaMetros, isPaihuen } from "./paihuen";

/** Filas medidas sobre reservas reales del establecimiento (#357). */
const HISTORICAS = [
  { nombre: "Paihuen", direccion: "Paihuen, Ruta Nac. 40 Ex. 234 km 78", punto: [-40.1757091, -71.3942727] as const },
  { nombre: "Paihuen", direccion: "Paihuen, Ruta Nac. 40 Ex. 234 km 78", punto: [...PAIHUEN_POINT] as const },
  { nombre: null, direccion: "Paihuén Villa de Montaña, Camino de los Coihues", punto: [-40.1756048, -71.3943165] as const },
  { nombre: null, direccion: "Paihuén Villa de Montaña, Camino de los Coihues", punto: [-40.1755939, -71.3943207] as const }
];

describe("isPaihuen", () => {
  it("detecta las cuatro reservas históricas, escritas a mano o elegidas del buscador", () => {
    for (const fila of HISTORICAS) {
      expect(isPaihuen(fila.nombre, fila.direccion, [...fila.punto])).toBe(true);
    }
  });

  it("acepta variantes del nombre sin depender de la grafía", () => {
    for (const label of ["Paihuén", "Hotel Paihuén", "Cabañas Paihuén", "Paihuén Resort & Spa", "Paihuen Villa de Montana"]) {
      expect(isPaihuen(null, label, null)).toBe(true);
    }
  });

  it("usa un radio real contra el catálogo (≈3 m del geocoder entra, 300 m no)", () => {
    const casi = [PAIHUEN_POINT[0] + 0.00003, PAIHUEN_POINT[1] + 0.00003] as const;
    expect(distanciaMetros([...casi], PAIHUEN_POINT)).toBeLessThan(PAIHUEN_RADIUS_M);
    expect(isPaihuen(null, null, [...casi])).toBe(true);
    const lejos = [PAIHUEN_POINT[0] + 0.0027, PAIHUEN_POINT[1]] as const;
    expect(distanciaMetros([...lejos], PAIHUEN_POINT)).toBeGreaterThan(PAIHUEN_RADIUS_M);
    expect(isPaihuen(null, null, [...lejos])).toBe(false);
  });

  it("no cobra Paihuén a una dirección vecina", () => {
    expect(isPaihuen(null, "Los Notros 100, San Martín de los Andes", [-40.1561, -71.3526])).toBe(false);
    expect(isPaihuen("Hostal del Esquiador", "Los Notros 100", null)).toBe(false);
    expect(isPaihuen(null, null, null)).toBe(false);
  });

  it("no confunde palabras que sólo contienen «paihuen»", () => {
    expect(isPaihuen(null, "Paihuenco 25", null)).toBe(false);
  });
});
