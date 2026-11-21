import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), manage: vi.fn(), revalidate: vi.fn() }));

/** `redirect` corta la acción: en el test se ve como una excepción con la URL de destino. */
class Redirect extends Error {
  constructor(readonly url: string) { super(url); }
}

vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({
  getCurrentReservationsUserOrRedirect: m.user,
  getCurrentAdminOrRedirect: m.user
}));
vi.mock("@/lib/booking/repository", () => {
  class BookingError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  }
  return {
    BookingError,
    createWebReservation: vi.fn(),
    approveManualPayment: vi.fn(),
    rejectManualPayment: vi.fn(),
    reviewDisabilityDocument: vi.fn()
  };
});
// El esquema de management es real (es lo que se prueba); la escritura a la base va mockeada.
vi.mock("@/lib/booking/admin-management", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booking/admin-management")>();
  return { ...actual, manageReservation: m.manage };
});

import { initialAdminFormState } from "@/app/admin/form-state";
import { updateReservationAction } from "@/app/admin/reservas/actions";

const code = "ARC-2611-TEST";
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  data.set("code", code);
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "user-1", name: "Vale", email: "vale@example.com", role: "SECRETARY" });
  m.manage.mockResolvedValue({ receiptPath: null });
});

describe("editar el domicilio del traslado desde el panel (#268)", () => {
  it("guarda el alojamiento como texto cuando no hay punto", async () => {
    await expect(updateReservationAction(initialAdminFormState, form({ address: "Hostal del Esquiador" })))
      .rejects.toMatchObject({ url: expect.stringContaining("Cambios") });

    expect(m.manage).toHaveBeenCalledWith(code, expect.objectContaining({
      operation: "edit",
      pickup: { address: "Hostal del Esquiador", point: null }
    }), expect.anything());
  });

  it("con coordenadas sigue exigiendo que el operador confirme el punto", async () => {
    const state = await updateReservationAction(initialAdminFormState, form({
      address: "Coronel Rohde 975", latitude: "-40.1565", longitude: "-71.3497"
    }));

    expect(state).toMatchObject({ status: "error", message: "", fieldErrors: { pickupPoint: "Confirmá el punto de traslado en el mapa." } });
    expect(m.manage).not.toHaveBeenCalled();
  });

  it("un punto a medias no se guarda como si fuera texto", async () => {
    const state = await updateReservationAction(initialAdminFormState, form({
      address: "Coronel Rohde 975", latitude: "-40.1565", confirmed: "on"
    }));

    expect(state).toMatchObject({ status: "error", message: "", fieldErrors: { pickupPoint: expect.stringMatching(/incompleto/) } });
    expect(m.manage).not.toHaveBeenCalled();
  });
});
