import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const ui = (path: string) => source(`src/app/admin/excursiones/${path}`);

describe("excursiones: contrato de la interfaz del panel", () => {
  it.each(["page.tsx", "nueva/page.tsx", "[id]/page.tsx"])("protege %s y conserva el rol del operador", (path) => {
    const page = ui(path);
    expect(page).toContain("await getCurrentReservationsUserOrRedirect()");
    expect(page).toContain("role={user.role}");
    expect(page).not.toContain("getCurrentAdminOrRedirect");
  });

  it("ofrece el módulo tanto a administración como a secretaría", () => {
    expect(source("src/components/admin-shell.tsx")).toMatch(/href: "\/admin\/excursiones", label: "Excursiones", roles: \["ADMIN", "SECRETARY"\]/);
  });

  it("usa el contrato de guardado y la versión de concurrencia", () => {
    expect(ui("nueva/page.tsx")).toContain("saveExcursion.bind(null, null, null)");
    expect(ui("[id]/page.tsx")).toContain("saveExcursion.bind(null, excursion.id, excursion.updatedAt.toISOString())");
    // Photo mutations also update the version; remount controlled state with it.
    expect(ui("[id]/page.tsx")).toContain("key={excursion.updatedAt.toISOString()}");
    const form = ui("excursion-form.tsx");
    for (const field of ["name", "description", "duration", "price", "currency", "isPublished", "departures"]) {
      expect(form).toContain(`name="${field}"`);
    }
    expect(form).toContain("useActionState(action, initialAdminFormState)");
    expect(form).toContain("AdminFormAlert");
    expect(form).toContain("AdminSubmitButton");
  });

  it("crea borradores y exige fotos antes de publicar", () => {
    const form = ui("excursion-form.tsx");
    expect(form).toContain("excursion?.isPublished ?? false");
    expect(form).toContain("disabled={!canPublish}");
    expect(form).toContain("photoCount > 0");
    expect(ui("nueva/page.tsx")).toContain("Las fotos se cargan después de crear el borrador");
  });

  it("serializa hasta cien fechas locales sin reinterpretarlas con el huso del navegador", () => {
    const form = ui("excursion-form.tsx");
    expect(form).toContain('type="datetime-local"');
    expect(form).toContain("JSON.stringify(departures)");
    expect(form).toContain("departures.length >= 100");
    expect(form).toContain("Hora argentina (UTC−3)");
    expect(form).not.toContain("new Date(");
    expect(ui("[id]/page.tsx")).toContain("excursionLocalDateTime(departure.departureAt)");
  });

  it("distingue fechas pasadas de próximas y permite no cargar fechas", () => {
    expect(ui("page.tsx")).toContain("Sin próximas fechas");
    expect(ui("[id]/page.tsx")).toContain("Sin próximas fechas");
    expect(ui("excursion-form.tsx")).toContain("Podés guardar la excursión sin fechas");
  });

  it("sube una sola foto con el tipo y tamaño indicados", () => {
    const form = ui("photo-form.tsx");
    expect(form).toContain('name="photo"');
    expect(form).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(form).toContain("3 * 1024 * 1024");
    expect(form).not.toContain("multiple");
    expect(ui("[id]/page.tsx")).toContain("uploadExcursionPhoto.bind(null, excursion.id)");
  });

  it("permite portada y galería sin exponer el almacenamiento de blobs", () => {
    const page = ui("[id]/page.tsx");
    expect(page).toContain("/excursiones/fotos/${photo.id}");
    expect(page).toContain("makeExcursionCover.bind(null, excursion.id, photo.id)");
    expect(page).toContain("removeExcursionPhoto.bind(null, excursion.id, photo.id)");
    expect(page).not.toContain("photo.blobPathname");
    expect(page).toContain("/excursiones/${excursion.id}");
  });

  it("pide una confirmación escrita y explícita antes de eliminar toda la excursión", () => {
    const form = ui("excursion-form.tsx");
    expect(form).toContain('name="confirm"');
    expect(form).toContain('pattern="ELIMINAR"');
    expect(form).toContain('confirmation !== "ELIMINAR"');
    expect(form).toContain("Esta acción no se puede deshacer");
    expect(ui("[id]/page.tsx")).toContain("deleteExcursion.bind(null, excursion.id)");
  });
});
