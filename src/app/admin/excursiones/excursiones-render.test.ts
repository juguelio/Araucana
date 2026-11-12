import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExcursionForm, DeleteExcursionForm } from "./excursion-form";
import { ExcursionPhotoForm } from "./photo-form";
import { initialAdminFormState } from "../form-state";

const action = async () => initialAdminFormState;

describe("formularios de excursiones: render real", () => {
  it("inicia el alta como borrador, sin precio ni fechas y sin opción de publicación", () => {
    const html = renderToStaticMarkup(createElement(ExcursionForm, { action }));
    expect(html).toContain("Crear borrador");
    expect(html).toMatch(/name="price"[^>]*value=""/);
    expect(html).toMatch(/name="departures"[^>]*value="\[\]"/);
    expect(html.match(/<input[^>]*name="isPublished"[^>]*>/)?.[0]).toContain('disabled=""');
    expect(html).not.toContain('checked=""');
    expect(html).toContain("Sin fechas cargadas");
  });

  it("recupera los datos, centavos y fechas locales para editar una publicación", () => {
    const html = renderToStaticMarkup(createElement(ExcursionForm, {
      action,
      photoCount: 2,
      excursion: {
        name: "Lago & bosque", description: "Un paseo por el lago.", duration: "Día completo",
        priceCents: 1234567, currency: "USD", isPublished: true,
        departures: ["2026-12-01T10:30", "2026-11-01T08:00"]
      }
    }));
    expect(html).toContain('value="Lago &amp; bosque"');
    expect(html).toContain('value="12345.67"');
    expect(html).toContain('value="USD" selected=""');
    expect(html).toMatch(/name="isPublished"[^>]*checked=""/);
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-12-01T10:30"');
    expect(html).toContain('value="2026-11-01T08:00"');
    expect(html).toContain("2 / 100 salidas");
  });

  it("no ofrece agregar más fechas al alcanzar el máximo de cien", () => {
    const html = renderToStaticMarkup(createElement(ExcursionForm, {
      action,
      excursion: { name: "Paseo", description: "Descripción", duration: "4 h", priceCents: null,
        currency: "ARS", isPublished: false, departures: Array.from({ length: 100 }, () => "2026-12-01T10:00") }
    }));
    expect(html).toContain('disabled="">Agregar fecha de salida');
    expect(html).toContain("100 / 100 salidas");
  });

  it("renderiza un único selector de archivo de imagen y un botón de carga", () => {
    const html = renderToStaticMarkup(createElement(ExcursionPhotoForm, { action }));
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).not.toContain("multiple");
    expect(html).toContain("máximo 3 MB");
    expect(html).toContain("Subir foto");
  });

  it("mantiene la eliminación colapsada y deshabilitada hasta confirmar", () => {
    const html = renderToStaticMarkup(createElement(DeleteExcursionForm, { action: async () => {}, name: "Lago" }));
    expect(html).toContain("<summary>Eliminar excursión</summary>");
    expect(html).not.toContain('open=""');
    expect(html).toContain('pattern="ELIMINAR"');
    expect(html).toContain('disabled="">Eliminar definitivamente');
  });
});
