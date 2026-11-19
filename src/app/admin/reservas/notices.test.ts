import { describe, expect, it } from "vitest";
import { reservationNotice } from "./notices";

describe("volver al listado", () => {
  it("conserva la cola y la página con las que se estaba trabajando", () => {
    // El admin filtra «Pago por confirmar» y valida: tiene que volver a esa misma cola
    // (19-nov: «validar un pago tiene que ser rápido y fácil para el admin»).
    expect(reservationNotice("/admin/reservas", "Pago validado con éxito.", "payment=pending-payment&page=1")).toBe(
      "/admin/reservas?payment=pending-payment&page=1&notice=Pago+validado+con+%C3%A9xito."
    );
  });

  it("sin filtros vuelve al listado pelado con el aviso", () => {
    expect(reservationNotice("/admin/reservas", "Comprobante rechazado.")).toBe(
      "/admin/reservas?notice=Comprobante+rechazado."
    );
  });
});
