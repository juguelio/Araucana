import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ photo: vi.fn(), get: vi.fn(), user: vi.fn(), token: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get: mocks.get }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { excursionPhoto: { findUnique: mocks.photo } } }));
vi.mock("@/lib/auth/service", () => ({ getAppUserFromToken: mocks.user, getTokenFromRequest: mocks.token }));
import { GET } from "./route";
const context = { params: Promise.resolve({ id: "p1" }) };
const request = new Request("http://localhost/excursiones/fotos/p1");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.photo.mockResolvedValue({ contentType: "image/jpeg", blobPathname: "excursion-photos/e1/p1.jpg", excursion: { isPublished: false } });
  mocks.get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff])); controller.close(); } }) });
});
it("no sirve fotos de borrador a anónimos, usuarios o choferes", async () => {
  for (const user of [null, { isActive: true, role: "USER" }, { isActive: true, role: "DRIVER" }, { isActive: false, role: "ADMIN" }]) {
    mocks.user.mockResolvedValue(user);
    expect((await GET(request, context)).status).toBe(404);
  }
  expect(mocks.get).not.toHaveBeenCalled();
});
it.each(["ADMIN", "SECRETARY"])("%s ve fotos de borrador sin cache público", async (role) => {
  mocks.user.mockResolvedValue({ isActive: true, role });
  const response = await GET(request, context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toBe("image/jpeg");
});
it("las fotos publicadas son accesibles sin exponer rutas de Blob", async () => {
  mocks.photo.mockResolvedValue({ contentType: "image/jpeg", blobPathname: "excursion-photos/e1/p1.jpg", excursion: { isPublished: true } });
  expect((await GET(request, context)).status).toBe(200);
  expect(mocks.user).not.toHaveBeenCalled();
  expect(mocks.get).toHaveBeenCalledWith("excursion-photos/e1/p1.jpg", { access: "private" });
});
it("maneja foto eliminada y servicio Blob caído", async () => {
  mocks.photo.mockResolvedValueOnce(null);
  expect((await GET(request, context)).status).toBe(404);
  mocks.user.mockResolvedValue({ isActive: true, role: "ADMIN" });
  mocks.get.mockRejectedValue(new Error("remote secret"));
  const response = await GET(request, context);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("remote secret");
});
