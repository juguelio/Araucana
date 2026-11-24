import { expect, it } from "vitest";
import { specialTripsViewFor, specialTripsViewHref } from "./view";

it("abre el calendario al entrar al módulo y mantiene los filtros compartidos", () => {
  const params = new URLSearchParams("q=Villa+Traful&nave=v1");
  expect(specialTripsViewFor((key) => params.get(key))).toBe("calendario");
  expect(specialTripsViewHref("calendario", (key) => params.get(key)))
    .toBe("/admin/viajes-especiales/semana?q=Villa+Traful&nave=v1");
});

it("conserva enlaces al listado y omite sus controles al cambiar de pestaña", () => {
  const params = new URLSearchParams("vista=realizados&pagina=2&semana=2026-11-23&estado=COMPLETED");
  expect(specialTripsViewFor((key) => params.get(key))).toBe("listado");
  expect(specialTripsViewHref("listado", (key) => params.get(key)))
    .toBe("/admin/viajes-especiales?modo=listado&semana=2026-11-23&estado=COMPLETED");
  const href = specialTripsViewHref("calendario", (key) => params.get(key));
  expect(href).toBe("/admin/viajes-especiales/semana?semana=2026-11-23&estado=COMPLETED");
});
