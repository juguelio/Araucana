import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PassengerFields, initialPassenger, validateCheckoutPassenger, buildPassengerPayload } from "./passenger-fields";

// La nacionalidad es opcional en todos los formularios del pasajero (pedido de Jugue, 19-nov).
describe("PassengerFields: nacionalidad opcional", () => {
  const html = renderToStaticMarkup(createElement(PassengerFields, { passenger: initialPassenger, fieldErrors: {}, onChange: () => {} }));

  it("el campo dice «(opcional)» y no es obligatorio", () => {
    expect(html).toContain("Nacionalidad (opcional)");
    const campo = html.match(/<input[^>]*name="nationality"[^>]*>/)?.[0] ?? "";
    expect(campo).not.toBe("");
    expect(campo).not.toContain("required");
  });

  it("usa el prefijo argentino inicial para guardar un teléfono local sin nacionalidad", () => {
    expect(html).toMatch(/<option value="\+54" selected="">/);
    const completo = { ...initialPassenger, firstName: "Ana", lastName: "Prueba", email: "ana@example.com", phone: "2972412345", documentId: "30111222" };
    expect(validateCheckoutPassenger(completo)).toEqual({});
    expect(buildPassengerPayload(completo).phone).toBe("+542972412345");
  });
});

it.each(["", "+1", "+54"])("acepta un número completo sin signo + con el prefijo seleccionado %s", (phoneCountryCode) => {
  const passenger = {
    ...initialPassenger, firstName: "Ana", lastName: "Prueba", email: "ana@example.com",
    phoneCountryCode, phone: "1 (202) 983-3018", documentId: "30111222"
  };
  expect(validateCheckoutPassenger(passenger)).toEqual({});
  expect(buildPassengerPayload(passenger).phone).toBe("+12029833018");
});
