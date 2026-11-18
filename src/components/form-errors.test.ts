import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormErrorSummary, focusFirstInvalid, orderedFieldErrors } from "./form-errors";
import { PassengerFields, initialPassenger } from "@/app/reservar/[slug]/passenger-fields";

/**
 * #242: el error del alta tiene que marcar el campo, dejar el mensaje al lado, llevar el foco al
 * primero que falla y mostrar un resumen con links sólo cuando hay más de uno.
 *
 * La suite corre en node (sin DOM): lo que se prueba es la decisión (qué campo se elige y en qué
 * orden) y el marcado; el foco real sobre el input lo cubre el recorrido del formulario.
 */

describe("orden de los errores", () => {
  it("respeta el orden en que se ven los campos, no el que devuelve el servidor", () => {
    const errors = { documentId: "Ingresá un DNI de 7 u 8 dígitos.", firstName: "Ingresa el nombre.", email: "Email inválido." };
    const order = ["firstName", "lastName", "email", "documentId"];

    expect(orderedFieldErrors(errors, order).map((entry) => entry.name)).toEqual(["firstName", "email", "documentId"]);
  });

  it("los errores que no están en el orden van al final y descarta los vacíos", () => {
    expect(orderedFieldErrors({ customPrice: "", phone: "Teléfono inválido." }, ["phone"])).toEqual([
      { name: "phone", message: "Teléfono inválido." }
    ]);
  });
});

describe("foco en el primer campo con error", () => {
  it("enfoca y scrollea el primero del formulario que tiene control", () => {
    const enfocados: string[] = [];
    const campo = (name: string) => ({ focus: () => enfocados.push(name), scrollIntoView: () => enfocados.push(`scroll:${name}`) });
    const lookup = (name: string) => (name === "lastName" ? campo("lastName") : name === "email" ? campo("email") : null);

    const resultado = focusFirstInvalid({ documentId: "DNI inválido.", email: "Email inválido." }, ["email", "documentId"], lookup);

    // `email` va antes en el formulario y tiene control; `documentId` ni se intenta.
    expect(resultado).toBe("email");
    expect(enfocados).toEqual(["email", "scroll:email"]);
  });

  it("saltea un error sin control y sigue con el siguiente (no rompe el envío)", () => {
    const enfocados: string[] = [];
    const lookup = (name: string) => (name === "documentId" ? { focus: () => enfocados.push(name) } : null);

    expect(focusFirstInvalid({ scheduleId: "No hay cupo.", documentId: "DNI inválido." }, ["scheduleId", "documentId"], lookup)).toBe("documentId");
    expect(enfocados).toEqual(["documentId"]);
  });
});

describe("resumen de errores", () => {
  it("con un solo error no se dibuja: alcanza el mensaje al lado del campo", () => {
    const html = renderToStaticMarkup(createElement(FormErrorSummary, { fieldErrors: { email: "Ingresá un email válido." }, order: ["email"] }));
    expect(html).toBe("");
  });

  it("con dos errores lista los dos inline y arriba con un link por campo", () => {
    const html = renderToStaticMarkup(
      createElement(FormErrorSummary, {
        fieldErrors: { firstName: "Ingresá el nombre del pasajero.", documentId: "Ingresá un DNI de 7 u 8 dígitos." },
        order: ["firstName", "documentId"]
      })
    );

    expect(html).toContain("Revisá estos 2 campos");
    expect(html).toContain('href="#firstName"');
    expect(html).toContain('href="#documentId"');
    expect(html).toContain("Nombre: Ingresá el nombre del pasajero.");
    expect(html).toContain("Documento: Ingresá un DNI de 7 u 8 dígitos.");
    expect(html).toContain('role="alert"');
  });
});

describe("el campo con error se marca en el formulario", () => {
  it("el email mal formado queda con aria-invalid y su mensaje al lado", () => {
    const html = renderToStaticMarkup(
      createElement(PassengerFields, {
        passenger: { ...initialPassenger, email: "ana@" },
        fieldErrors: { email: "Ingresa un email valido." },
        onChange: () => {}
      })
    );

    // El input del email es el único con aria-invalid; el mensaje está asociado por aria-describedby.
    expect(html.match(/aria-invalid="true"/g)?.length).toBe(1);
    expect(html).toMatch(/aria-invalid="true" aria-describedby="email-error" required="" name="email"/);
    expect(html).toContain('aria-describedby="email-error"');
    expect(html).toContain('<span class="field-error" id="email-error">Ingresa un email valido.</span>');
  });
});
