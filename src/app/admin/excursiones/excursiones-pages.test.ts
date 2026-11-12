import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { guard, listExcursions, getExcursion } = vi.hoisted(() => ({
  guard: vi.fn(), listExcursions: vi.fn(), getExcursion: vi.fn()
}));

vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: guard }));
vi.mock("@/lib/excursions/repository", () => ({ listAdminExcursions: listExcursions, getAdminExcursion: getExcursion }));
vi.mock("./actions", () => ({
  saveExcursion: vi.fn(), uploadExcursionPhoto: vi.fn(), removeExcursionPhoto: vi.fn(),
  makeExcursionCover: vi.fn(), deleteExcursion: vi.fn()
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import ListPage from "./page";
import NewPage from "./nueva/page";
import EditPage from "./[id]/page";
import { ExcursionForm } from "./excursion-form";
import { saveExcursion } from "./actions";
import { initialAdminFormState } from "../form-state";

function findDataForm(node: ReactNode): ReactElement<ComponentProps<typeof ExcursionForm>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = findDataForm(child);
      if (result) return result;
    }
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === ExcursionForm) return node as ReactElement<ComponentProps<typeof ExcursionForm>>;
  return findDataForm(node.props.children);
}

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "excursion-1", name: "Lago escondido", description: "Recorrido por el bosque", duration: "Día completo",
    priceCents: null, currency: "ARS", isPublished: false, createdAt: new Date("2026-11-01T12:00:00Z"),
    updatedAt: new Date("2026-11-10T12:00:00Z"), photos: [], departures: [], ...overrides
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
  guard.mockResolvedValue({ role: "SECRETARY" });
  listExcursions.mockResolvedValue([]);
  getExcursion.mockResolvedValue(fixture());
});
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("páginas del panel de excursiones: render con repositorio aislado", () => {
  it("muestra el estado vacío y mantiene el menú de secretaría", async () => {
    const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({}) }));
    expect(guard).toHaveBeenCalledOnce();
    expect(html).toContain("Todavía no hay excursiones");
    expect(html).toContain('href="/admin/excursiones/nueva"');
    expect(html).toContain('href="/admin/excursiones"');
    expect(html).not.toContain('href="/admin/contabilidad"');
  });

  it("muestra próximas fechas argentinas sin elegir una fecha pasada", async () => {
    listExcursions.mockResolvedValue([fixture({ isPublished: true, priceCents: 4500050, departures: [
      { id: "old", departureAt: new Date("2026-11-01T12:00:00Z") },
      { id: "future", departureAt: new Date("2026-12-01T13:30:00Z") }
    ] })]);
    const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({ notice: "Guardado" }) }));
    expect(html).toContain("Guardado");
    expect(html).toContain("Publicada");
    expect(html).toContain("ARS 45.000,50");
    expect(html).toContain('dateTime="2026-12-01T13:30:00.000Z"');
    expect(html).toContain("10:30");
    expect(html).not.toContain('dateTime="2026-11-01T12:00:00.000Z"');
    expect(html).toContain('href="/excursiones/excursion-1"');
  });

  it("no presenta una fecha pasada como próxima ni un borrador como público", async () => {
    listExcursions.mockResolvedValue([fixture({ departures: [{ id: "old", departureAt: new Date("2026-11-01T12:00:00Z") }] })]);
    const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Sin próximas fechas");
    expect(html).toContain("Precio a consultar");
    expect(html).toContain("Borrador");
    expect(html).not.toContain('href="/excursiones/excursion-1"');
  });

  it("crea primero un borrador y todavía no muestra el selector de fotos", async () => {
    const html = renderToStaticMarkup(await NewPage());
    expect(html).toContain("Crear borrador");
    expect(html).toContain("Las fotos se cargan después de crear el borrador");
    expect(html).not.toContain('type="file"');
  });

  it("conserva también salidas pasadas para editar y muestra las fotos por la ruta autorizada", async () => {
    getExcursion.mockResolvedValue(fixture({
      photos: [{ id: "cover", position: 0, blobPathname: "private-path" }, { id: "gallery", position: 1, blobPathname: "another-private-path" }],
      departures: [{ id: "old", departureAt: new Date("2026-11-01T12:00:00Z") }]
    }));
    const html = renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id: "excursion-1" }), searchParams: Promise.resolve({}) }));
    expect(getExcursion).toHaveBeenCalledWith("excursion-1");
    expect(html).toContain("Sin próximas fechas");
    expect(html).toContain("1 salida pasada conservada");
    expect(html).toContain('value="2026-11-01T09:00"');
    expect(html).toContain('src="/excursiones/fotos/cover"');
    expect(html).toContain('src="/excursiones/fotos/gallery"');
    expect(html).not.toContain("private-path");
    expect(html).toContain("Usar como portada");
    expect(html).toContain("Subir foto");
    expect(html).toContain("No visible en la web pública");
  });

  it("reinicia el formulario y vincula la versión actualizada después de agregar una foto", async () => {
    const before = findDataForm(await EditPage({ params: Promise.resolve({ id: "excursion-1" }), searchParams: Promise.resolve({}) }));
    expect(before?.key).toBe("2026-11-10T12:00:00.000Z");
    const updatedAt = new Date("2026-11-12T12:00:01Z");
    getExcursion.mockResolvedValue(fixture({ updatedAt, photos: [{ id: "new-photo", position: 0 }] }));
    const after = findDataForm(await EditPage({ params: Promise.resolve({ id: "excursion-1" }), searchParams: Promise.resolve({}) }));
    expect(after).toBeDefined();
    expect(after?.key).toBe(updatedAt.toISOString());
    expect(after?.key).not.toBe(before?.key);
    expect(after?.props.photoCount).toBe(1);
    const form = new FormData();
    await after!.props.action(initialAdminFormState, form);
    expect(saveExcursion).toHaveBeenCalledWith("excursion-1", updatedAt.toISOString(), initialAdminFormState, form);
    const html = renderToStaticMarkup(after!);
    expect(html.match(/<input[^>]*name="isPublished"[^>]*>/)?.[0]).not.toContain('disabled=""');
  });

  it("responde notFound para una excursión inexistente", async () => {
    getExcursion.mockResolvedValue(null);
    await expect(EditPage({ params: Promise.resolve({ id: "missing" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  });

  it("no consulta datos si el guard rechaza el acceso", async () => {
    guard.mockRejectedValue(new Error("UNAUTHORIZED"));
    await expect(ListPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("UNAUTHORIZED");
    await expect(NewPage()).rejects.toThrow("UNAUTHORIZED");
    await expect(EditPage({ params: Promise.resolve({ id: "excursion-1" }), searchParams: Promise.resolve({}) })).rejects.toThrow("UNAUTHORIZED");
    expect(listExcursions).not.toHaveBeenCalled();
    expect(getExcursion).not.toHaveBeenCalled();
  });
});
