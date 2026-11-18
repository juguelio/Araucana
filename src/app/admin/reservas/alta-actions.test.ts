import { beforeEach, expect, it, vi } from "vitest";

// Alta manual de «Nueva reserva» (18-nov): los menores llegan al servidor.
const mocks = vi.hoisted(() => ({ auth: vi.fn(), crear: vi.fn(), idaYVuelta: vi.fn(), refresh: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: mocks.auth, getCurrentAdminOrRedirect: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));
vi.mock("@/lib/booking/repository", async (original) => ({
  ...(await original<typeof import("@/lib/booking/repository")>()),
  createWebReservation: mocks.crear
}));

import { createAdminReservationAction } from "./actions";
import { initialAdminFormState } from "../form-state";

const ADMIN = { id: "staff", name: "Ana", email: "ana@example.com", role: "SECRETARY" };

function formulario(campos: Record<string, string>) {
  const form = new FormData();
  const base = { scheduleId: "salida-ida", passengerCount: "3", firstName: "Lucía", lastName: "Prueba", documentType: "DNI", documentId: "30111222" };
  for (const [clave, valor] of Object.entries({ ...base, ...campos })) form.set(clave, valor);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(ADMIN);
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`); });
  mocks.crear.mockResolvedValue({ code: "ARC-IDA", route: { slug: "sma-villa-traful" } });
});

it("los menores del formulario llegan a la reserva (antes se perdían y se cobraba tarifa entera)", async () => {
  await expect(createAdminReservationAction(initialAdminFormState, formulario({ halfFareCount: "1", freeFareCount: "1" })))
    .rejects.toThrow("redirect:/admin/reservas/ARC-IDA");
  expect(mocks.crear).toHaveBeenCalledWith(
    expect.objectContaining({ scheduleId: "salida-ida", passengerCount: 3, halfFareCount: 1, freeFareCount: 1 }),
    expect.objectContaining({ fromAdmin: true })
  );
});
