import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialAdminFormState } from "../../../form-state";
import { uploadVehicleDocumentAction } from "./actions";

const db = vi.hoisted(() => ({
  vehicle: { findUnique: vi.fn(), update: vi.fn() },
  vehicleDocument: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn()
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/admin", () => ({ getCurrentAdminOrRedirect: async () => ({ id: "admin" }) }));
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }));
vi.mock("../../revalidate", () => ({ revalidarNaves: vi.fn() }));
vi.mock("@/lib/vehicles/document-storage", () => ({
  almacenamientoDeDocumentosDisponible: () => true,
  guardarDocumentoDeNave: async () => ({ fileName: "poliza.pdf", sizeBytes: 12, contentType: "application/pdf", blobPathname: "demo/poliza.pdf", blobUrl: "https://example.invalid/poliza.pdf" })
}));

describe("adjuntar una póliza", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.vehicle.findUnique.mockResolvedValue({ id: "nave", name: "Nave demo" });
    db.$transaction.mockImplementation(action => action(db));
    db.$queryRaw.mockResolvedValue([{ secondaryPolicyDueAt: new Date("2030-01-01") }]);
    db.vehicleDocument.create.mockResolvedValue({ fileName: "poliza.pdf" });
  });

  async function subir(kind: string, expiresAt: string) {
    const form = new FormData();
    form.set("vehicleId", "nave");
    form.set("kind", kind);
    form.set("expiresAt", expiresAt);
    form.set("file", new File(["%PDF-1.7\n"], "papel.pdf", { type: "application/pdf" }));
    return uploadVehicleDocumentAction(initialAdminFormState, form);
  }

  it("al renovar la segunda cobertura actualiza sólo su vencimiento y guarda una nueva versión", async () => {
    expect((await subir("POLIZA_SERVICIO_PUBLICO", "2031-04-10")).status).toBe("success");
    expect(db.vehicle.update).toHaveBeenCalledWith({ where: { id: "nave" }, data: { secondaryPolicyDueAt: new Date("2031-04-10T12:00:00-03:00") } });
    expect(db.vehicleDocument.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vehicleId: "nave", kind: "POLIZA_SERVICIO_PUBLICO" }) });
  });

  it.each([["POLIZA_SERVICIO_PUBLICO", ""], ["POLIZA", "2031-04-10"]])("subir %s con fecha «%s» conserva los vencimientos cargados", async (kind, date) => {
    expect((await subir(kind, date)).status).toBe("success");
    expect(db.vehicle.update).not.toHaveBeenCalled();
    expect(db.vehicleDocument.create).toHaveBeenCalledOnce();
  });
});
