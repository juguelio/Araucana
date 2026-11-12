import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), save: vi.fn(), current: vi.fn(), add: vi.fn(), remove: vi.fn(), cover: vi.fn(), delete: vi.fn(), store: vi.fn(), cleanup: vi.fn(), refresh: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/excursions/repository", () => ({ saveExcursionRecord: mocks.save, getAdminExcursion: mocks.current, addExcursionPhoto: mocks.add, removeExcursionPhotoRecord: mocks.remove, makeExcursionCoverRecord: mocks.cover, deleteExcursionRecord: mocks.delete }));
vi.mock("@/lib/excursions/storage", () => ({ storeExcursionPhoto: mocks.store, deleteExcursionBlobs: mocks.cleanup }));
import { deleteExcursion, makeExcursionCover, removeExcursionPhoto, saveExcursion, uploadExcursionPhoto } from "./actions";
import { initialAdminFormState } from "../form-state";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ id: "staff", role: "SECRETARY" });
  mocks.redirect.mockImplementation((url) => { throw new Error(`redirect:${url}`); });
});
it("todas las escrituras exigen autorización antes de tocar datos o Blob", async () => {
  mocks.auth.mockRejectedValue(new Error("auth-denied"));
  const calls = [() => saveExcursion(null, null, initialAdminFormState, new FormData()), () => uploadExcursionPhoto("e1", initialAdminFormState, new FormData()), () => removeExcursionPhoto("e1", "p1", new FormData()), () => makeExcursionCover("e1", "p1", new FormData()), () => deleteExcursion("e1", new FormData())];
  for (const call of calls) await expect(call()).rejects.toThrow("auth-denied");
  for (const mock of [mocks.save, mocks.current, mocks.add, mocks.remove, mocks.cover, mocks.delete, mocks.store]) expect(mock).not.toHaveBeenCalled();
});
it("no elimina sin confirmación explícita", async () => {
  await expect(deleteExcursion("e1", new FormData())).rejects.toThrow("redirect:");
  expect(mocks.delete).not.toHaveBeenCalled();
});
it("elimina y limpia sólo lo devuelto por la transacción", async () => {
  mocks.delete.mockResolvedValue(["excursion-photos/e1/p1.jpg"]);
  const form = new FormData(); form.set("confirm", "ELIMINAR");
  await expect(deleteExcursion("e1", form)).rejects.toThrow("redirect:/admin/excursiones?notice=");
  expect(mocks.cleanup).toHaveBeenCalledWith(["excursion-photos/e1/p1.jpg"]);
});
it("una foto subida que no se pudo asociar se limpia", async () => {
  mocks.current.mockResolvedValue({ photos: [] });
  mocks.store.mockResolvedValue({ blobPathname: "excursion-photos/e1/p1.jpg", contentType: "image/jpeg" });
  mocks.add.mockRejectedValue(new Error("database failed"));
  const form = new FormData(); form.set("photo", new File(["x"], "x.jpg", { type: "image/jpeg" }));
  const result = await uploadExcursionPhoto("e1", initialAdminFormState, form);
  expect(result.status).toBe("error");
  expect(result.message).not.toContain("database failed");
  expect(mocks.cleanup).toHaveBeenCalledWith(["excursion-photos/e1/p1.jpg"]);
});
it("guardar invalida listado y detalle en los tres idiomas", async () => {
  mocks.save.mockResolvedValue({ id: "e1" });
  await expect(saveExcursion("e1", "version", initialAdminFormState, new FormData())).rejects.toThrow("redirect:");
  for (const prefix of ["", "/en", "/pt"]) {
    expect(mocks.refresh).toHaveBeenCalledWith(`${prefix}/excursiones`);
    expect(mocks.refresh).toHaveBeenCalledWith(`${prefix}/excursiones/e1`);
  }
});
