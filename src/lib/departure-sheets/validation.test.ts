import { describe, expect, it } from "vitest";
import { departurePassengerSchema } from "./validation";

const pasajeroDut = {
  firstName: "Ana",
  lastName: "Pérez",
  documentType: "DNI",
  documentNumber: "30.111.222",
  sex: "F",
  birthDate: "1985-04-12",
  nationality: "Argentina"
};

describe("planilla DUT: datos del pasajero", () => {
  it("acepta un pasajero con DNI con puntos y lo normaliza", () => {
    const parsed = departurePassengerSchema("DUT").parse(pasajeroDut);

    expect(parsed.documentNumber).toBe("30111222");
    expect(parsed.occupation).toBeNull();
    expect(parsed.residenceCountry).toBeNull();
    expect(parsed.birthDate.toISOString()).toBe("1985-04-12T15:00:00.000Z");
  });

  it("rechaza una fecha de nacimiento futura", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const result = departurePassengerSchema("DUT").safeParse({ ...pasajeroDut, birthDate: future });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("no puede ser futura");
  });

  it("rechaza un DNI de menos de 7 dígitos", () => {
    const result = departurePassengerSchema("DUT").safeParse({ ...pasajeroDut, documentNumber: "123" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["documentNumber"]);
  });

  it("no pide ocupación para el DUT", () => {
    const result = departurePassengerSchema("DUT").safeParse({ ...pasajeroDut, occupation: "" });

    expect(result.success).toBe(true);
  });
});

describe("registro de salida de la provincia: datos del pasajero", () => {
  it("exige ocupación y país de residencia", () => {
    const result = departurePassengerSchema("PROVINCIA").safeParse(pasajeroDut);

    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["occupation", "residenceCountry"]));
  });

  it("acepta el pasajero completo", () => {
    const parsed = departurePassengerSchema("PROVINCIA").parse({
      ...pasajeroDut,
      occupation: "Docente",
      residenceCountry: "Argentina"
    });

    expect(parsed).toMatchObject({ occupation: "Docente", residenceCountry: "Argentina" });
  });

  it("acepta un pasaporte alfanumérico", () => {
    const result = departurePassengerSchema("PROVINCIA").safeParse({
      ...pasajeroDut,
      documentType: "PAS",
      documentNumber: "AA123456",
      occupation: "Comerciante",
      residenceCountry: "Chile"
    });

    expect(result.success).toBe(true);
  });
});
