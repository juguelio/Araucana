import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import SchoolsPage from "./page";
import SchoolDetail from "./[id]/page";
import { SchoolEditPage } from "./edit-page";
import WeekPage from "./semana/page";

const fixture = vi.hoisted(() => ({
  id: "esc-7", serviceDate: new Date("2026-11-24T00:00:00Z"), kind: "escuela", routeName: "Primaria Quila Quina", shift: "Mañana",
  driverId: "ch-5", driver: { name: "Ana", email: "ana@example.test" }, vehicleId: "n-1", vehicle: { name: "153" },
  companion: "Luz", notes: "Entrada norte", review: "Confirmar horario", revision: 2, source: { sheet: "241126", row: 8 }
}));
vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: async () => ({ role: "SECRETARY" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/escolares", notFound: () => { throw Error("404"); } }));
vi.mock("./actions", () => ({ saveSchoolRun: vi.fn(), assignSchoolRunResources: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  schoolRun: { findMany: async () => [fixture], findUnique: async () => fixture, groupBy: async () => [] },
  user: { findMany: async () => [{ id: "ch-5", ...fixture.driver }] },
  vehicle: { findMany: async () => [{ id: "n-1", name: "153", licensePlate: "ABC123", internalNumber: "153" }] }
} }));

it("abre la ficha desde el listado y la edición desde la ficha", async () => {
  const list = renderToStaticMarkup(await SchoolsPage({ searchParams: Promise.resolve({ fecha: "2026-11-24" }) }));
  expect(list).toContain('href="/admin/escolares/esc-7">Primaria Quila Quina');
  expect(list).not.toContain('name="driverId"');
  // El día se agrupa por horario y muestra lo que hay que mirar.
  expect(list).toContain(">Mañana</h2>");
  expect(list).toContain("Confirmar horario");
  expect(list).toContain("Entrada norte");
  // El calendario semanal sigue arriba del día, con el día marcado, como en Viajes especiales.
  expect(list).toContain('aria-label="Calendario de la semana del 23 nov al 29 nov"');
  expect(list.match(/class="cn-semana-dia"/g)).toHaveLength(7);
  expect(list).toContain('data-actual="true"');
  expect(list).toContain('href="/admin/escolares?fecha=2026-11-24#servicio-esc-7"');
  expect(list).toContain('id="servicio-esc-7"');
  // El patrón común de los módulos: rótulo, Semana · Día y la barra del día de Aeropuerto.
  expect(list).toContain('<p class="eyebrow">Servicios</p>');
  expect(list).toContain('href="/admin/escolares/semana?semana=2026-11-23">Semana</a>');
  expect(list).toContain(">‹ Anterior</a>");
  expect(list).toContain(">Importar</a>");
  const detail = renderToStaticMarkup(await SchoolDetail({ params: Promise.resolve({ id: fixture.id }), searchParams: Promise.resolve({}) }));
  expect(detail).toContain('href="/admin/escolares/esc-7/editar"');
  expect(detail).toContain("Entrada norte");
  expect(detail).not.toContain("<textarea");
});

it("muestra la semana en el calendario común, con los servicios del día", async () => {
  const week = renderToStaticMarkup(await WeekPage({ searchParams: Promise.resolve({ semana: "2026-11-23" }) }));
  expect(week).toContain("Primaria Quila Quina");
  expect(week).toContain('aria-label="Semana anterior"');
  expect(week.match(/class="weekly-calendar-day"/g)).toHaveLength(7);
  expect(week.match(/weekly-calendar-day-link/g)).toHaveLength(7);
  expect(week).toContain('href="/admin/escolares?fecha=2026-11-24"');
  // La tarjeta abre el día con su tipo y en ese servicio.
  expect(week).toContain("fecha=2026-11-24&amp;tipo=escuela#servicio-esc-7");
  expect(week).toContain('<p class="eyebrow">Servicios</p>');
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
