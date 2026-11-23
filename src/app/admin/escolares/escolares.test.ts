import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import SchoolsPage from "./page";
import SchoolDetail from "./[id]/page";
import { SchoolEditPage } from "./edit-page";

const fixture = vi.hoisted(() => ({
  id: "esc-7", serviceDate: new Date("2026-11-24T00:00:00Z"), kind: "escuela", routeName: "Primaria Quila Quina", shift: "Mañana",
  driverId: "ch-5", driver: { name: "Ana", email: "ana@example.test" }, vehicleId: "n-1", vehicle: { name: "153" },
  companion: "Luz", notes: "Entrada norte", review: "Confirmar horario", revision: 2, source: { sheet: "241126", row: 8 }
}));
vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: async () => ({ role: "SECRETARY" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/escolares", notFound: () => { throw Error("404"); } }));
vi.mock("./actions", () => ({ saveSchoolRun: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  schoolRun: { findMany: async () => [fixture], findUnique: async () => fixture, groupBy: async () => [] },
  user: { findMany: async () => [{ id: "ch-5", ...fixture.driver }] },
  vehicle: { findMany: async () => [{ id: "n-1", name: "153", licensePlate: "ABC123", internalNumber: "153" }] }
} }));

it("abre la ficha desde el listado y la edición desde la ficha", async () => {
  const list = renderToStaticMarkup(await SchoolsPage({ searchParams: Promise.resolve({ fecha: "2026-11-24" }) }));
  expect(list).toContain('href="/admin/escolares/esc-7">Primaria Quila Quina');
  expect(list).not.toContain('name="driverId"');
  const detail = renderToStaticMarkup(await SchoolDetail({ params: Promise.resolve({ id: fixture.id }), searchParams: Promise.resolve({}) }));
  expect(detail).toContain('href="/admin/escolares/esc-7/editar"');
  expect(detail).toContain("Entrada norte");
  expect(detail).not.toContain("<textarea");
});

it("precarga la asignación importada y todos los campos operativos", async () => {
  const edit = renderToStaticMarkup(await SchoolEditPage({ id: fixture.id }));
  for (const field of ["date", "kind", "shift", "routeName", "driverId", "vehicleId", "companion", "review", "notes"]) {
    expect(edit).toContain(`name="${field}"`);
  }
  for (const value of ["Mañana", "Primaria Quila Quina", "Luz", "Entrada norte", "Confirmar horario", "ABC123", "ana@example.test"]) {
    expect(edit).toContain(value);
  }
  expect(edit).toMatch(/<input[^>]*checked=""[^>]*value="ch-5"/);
  expect(edit).toMatch(/<input[^>]*checked=""[^>]*value="n-1"/);
});
