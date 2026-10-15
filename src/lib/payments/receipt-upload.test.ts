import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), get: vi.fn(), attach: vi.fn(), store: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ del: mocks.del }));
vi.mock("@/lib/booking/access", () => ({ requireReservationAccess: mocks.access }));
vi.mock("@/lib/booking/repository", () => ({
  getReservationByCode: mocks.get, attachManualPaymentReceipt: mocks.attach,
  BookingError: class extends Error { constructor(public code: string, message: string) { super(message); } }
}));
vi.mock("./receipt-storage", () => ({ storeManualPaymentReceipt: mocks.store }));
import { uploadReservationReceipt } from "./receipt-upload";

const receipt = () => new File(["%PDF-1.7"], "proof.pdf", { type: "application/pdf" });

describe("receipt storage lifecycle", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue(undefined);
    mocks.get.mockResolvedValue({ status: "PENDING_PAYMENT", payment: { provider: "MANUAL", status: "PENDING", receiptBlobPathname: "old" } });
    mocks.store.mockResolvedValue({ blobPathname: "new" });
    mocks.attach.mockResolvedValue({ code: "test" });
    mocks.del.mockResolvedValue(undefined);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "local-test-placeholder");
  });
  it("rejects missing reservations before storing anything", async () => {
    mocks.get.mockResolvedValue(null);
    await expect(uploadReservationReceipt("test", receipt())).rejects.toMatchObject({ code: "RESERVATION_NOT_FOUND" });
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("rejects unauthorized callers and approved payments before writing", async () => {
    mocks.access.mockRejectedValueOnce(new Error("forbidden"));
    await expect(uploadReservationReceipt("test", receipt())).rejects.toThrow("forbidden");
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ status: "CONFIRMED", payment: { provider: "MANUAL", status: "APPROVED" } });
    await expect(uploadReservationReceipt("test", receipt())).rejects.toMatchObject({ status: 409 });
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("reports missing storage configuration without attempting a write", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    await expect(uploadReservationReceipt("test", receipt())).rejects.toMatchObject({ status: 503 });
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("cleans only the new blob if association loses a concurrent race", async () => {
    mocks.attach.mockRejectedValue(new Error("serialization conflict"));
    await expect(uploadReservationReceipt("test", receipt())).rejects.toThrow("serialization conflict");
    expect(mocks.del).toHaveBeenCalledExactlyOnceWith("new");
  });
  it("removes the old blob only after association succeeds", async () => {
    await expect(uploadReservationReceipt("test", receipt())).resolves.toEqual({ code: "test" });
    expect(mocks.del).toHaveBeenCalledExactlyOnceWith("old");
    expect(mocks.attach.mock.invocationCallOrder[0]).toBeLessThan(mocks.del.mock.invocationCallOrder[0]);
  });
});
