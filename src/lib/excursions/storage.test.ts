import { beforeEach, expect, it, vi } from "vitest";
const blob = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => blob);
import { deleteExcursionBlobs, storeExcursionPhoto } from "./storage";
beforeEach(() => vi.resetAllMocks());
it("almacena sólo fotos válidas en el Blob privado, nunca comprobantes", async () => {
  blob.put.mockResolvedValue({ pathname: "excursion-photos/e1/file.jpg" });
  const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], "foto.jpg", { type: "image/jpeg" });
  expect(await storeExcursionPhoto("e1", photo)).toEqual({ blobPathname: "excursion-photos/e1/file.jpg", contentType: "image/jpeg" });
  expect(blob.put).toHaveBeenCalledWith(expect.stringMatching(/^excursion-photos\/e1\/.*\.jpg$/), photo, { access: "private", contentType: "image/jpeg", addRandomSuffix: true });
  await expect(storeExcursionPhoto("e1", new File(["%PDF-"], "doc.pdf", { type: "application/pdf" }))).rejects.toThrow();
  expect(blob.put).toHaveBeenCalledTimes(1);
});
it("la limpieza no puede borrar comprobantes y tolera fallo remoto", async () => {
  blob.del.mockRejectedValue(new Error("offline"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await deleteExcursionBlobs(["manual-payment-receipts/important.pdf", "excursion-photos/e1/file.jpg"]);
  expect(blob.del).toHaveBeenCalledWith(["excursion-photos/e1/file.jpg"]);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
