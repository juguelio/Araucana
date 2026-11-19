import { beforeEach, expect, it, vi } from "vitest";

// Alta manual de «Nueva reserva» (18-nov): los menores llegan al servidor y la vuelta crea el ida y vuelta.
const mocks = vi.hoisted(() => ({ auth: vi.fn(), crear: vi.fn(), idaYVuelta: vi.fn(), refresh: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: mocks.auth, getCurrentAdminOrRedirect: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));
vi.mock("@/lib/booking/repository", async (original) => ({
  ...(await original<typeof import("@/lib/booking/repository")>()),
  createWebReservation: mocks.crear,
  createRouteRoundTripReservation: mocks.idaYVuelta
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
  mocks.idaYVuelta.mockResolvedValue({
    roundTripId: "viaje-1",
    ida: { code: "ARC-IDA", route: { slug: "sma-villa-traful" } },
    vuelta: { code: "ARC-VUELTA", route: { slug: "villa-traful-sma" } }
  });
});

it("los menores del formulario llegan a la reserva (antes se perdían y se cobraba tarifa entera)", async () => {
  await expect(createAdminReservationAction(initialAdminFormState, formulario({ halfFareCount: "1", freeFareCount: "1" })))
    .rejects.toThrow("redirect:/admin/reservas/ARC-IDA");
  expect(mocks.crear).toHaveBeenCalledWith(
    expect.objectContaining({ scheduleId: "salida-ida", passengerCount: 3, halfFareCount: 1, freeFareCount: 1 }),
    expect.objectContaining({ fromAdmin: true })
  );
  expect(mocks.idaYVuelta).not.toHaveBeenCalled();
});

it("con la salida de la vuelta crea el ida y vuelta y abre la reserva de ida", async () => {
  await expect(createAdminReservationAction(initialAdminFormState, formulario({
    returnScheduleId: "salida-vuelta",
    dropoffStop: "Confluencia",
    returnDropoffStop: "Confluencia",
    halfFareCount: "1"
  }))).rejects.toThrow("redirect:/admin/reservas/ARC-IDA");
  expect(mocks.idaYVuelta).toHaveBeenCalledWith(
    expect.objectContaining({
      scheduleId: "salida-ida",
      returnScheduleId: "salida-vuelta",
      dropoffStop: "Confluencia",
      returnDropoffStop: "Confluencia",
      passengerCount: 3,
      halfFareCount: 1,
      freeFareCount: 0
    }),
    { creator: ADMIN }
  );
  expect(mocks.crear).not.toHaveBeenCalled();
  expect(mocks.refresh).toHaveBeenCalledWith("/admin/reservas/ARC-VUELTA");
});

it("si la vuelta es la misma salida, vuelve el error marcado en la vuelta", async () => {
  const resultado = await createAdminReservationAction(initialAdminFormState, formulario({ returnScheduleId: "salida-ida" }));
  expect(resultado.status).toBe("error");
  expect(resultado.status === "error" && resultado.fieldErrors.returnScheduleId).toBe("La vuelta tiene que ser otra salida que la ida.");
  expect(mocks.idaYVuelta).not.toHaveBeenCalled();
});

it("un error del servidor en el ida y vuelta se explica sin perder el formulario", async () => {
  const { BookingError } = await import("@/lib/booking/repository");
  mocks.idaYVuelta.mockRejectedValue(new BookingError("INVALID_ROUND_TRIP_ORDER", "La salida de la vuelta tiene que ser después de la de ida."));
  const resultado = await createAdminReservationAction(initialAdminFormState, formulario({ returnScheduleId: "salida-vuelta" }));
  expect(resultado).toMatchObject({ status: "error", message: "La salida de la vuelta tiene que ser después de la de ida." });
});

it("el teléfono llega como en el aeropuerto: código de país con bandera + número, y se juntan", async () => {
  await expect(createAdminReservationAction(initialAdminFormState, formulario({ phoneCountryCode: "+54", phone: "2972 412345" })))
    .rejects.toThrow("redirect:/admin/reservas/ARC-IDA");
  expect(mocks.crear.mock.calls[0][0].passenger.phone).toBe("+542972412345");
});

it("si el número ya viene completo (+…), no se le agrega el código", async () => {
  await expect(createAdminReservationAction(initialAdminFormState, formulario({ phoneCountryCode: "+54", phone: "+56 9 1234 5678" })))
    .rejects.toThrow("redirect:/admin/reservas/ARC-IDA");
  expect(mocks.crear.mock.calls[0][0].passenger.phone).toBe("+56912345678");
});
