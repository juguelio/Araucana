import { describe, expect, it } from "vitest";
import { receiptAccept, receiptUploadConfig, validateReceiptContent, validateReceiptFile } from "./receipt-validation";

function fileWithSize(size: number, type = "application/pdf") {
  return {
    name: "comprobante.pdf",
    size,
    type
  } as File;
}

describe("receipt validation", () => {
  it("allows receipts up to 10 MB", () => {
    expect(receiptUploadConfig.maxSizeBytes).toBe(10 * 1024 * 1024);
    expect(validateReceiptFile(fileWithSize(10 * 1024 * 1024))).toBeNull();
  });

  it("rejects receipts larger than 10 MB with a user-facing message", () => {
    expect(validateReceiptFile(fileWithSize(10 * 1024 * 1024 + 1))).toBe("El comprobante no puede superar 10 MB.");
  });

  it.each(["image/heic", "image/heif", "", "application/octet-stream"])("allows an iPhone photo with MIME %s", (type) => {
    expect(validateReceiptFile(new File(["photo"], "IMG_0001.HEIC", { type }))).toBeNull();
  });

  it("does not allow arbitrary files with missing or generic MIME", () => {
    for (const type of ["", "application/octet-stream"]) {
      expect(validateReceiptFile(new File(["x"], "file.exe", { type }))).toMatch(/Elegí un comprobante/);
    }
    expect(receiptAccept).toContain("image/heic");
    expect(receiptAccept).toContain(".heif");
  });

  it("rejects invalid HEIF box lengths and AVIF masquerading as HEIC", async () => {
    for (const header of [
      new Uint8Array([0, 0, 0, 8, ...Buffer.from("ftypheic")]),
      new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypavif"), 0, 0, 0, 0, ...Buffer.from("mif1avif")])
    ]) {
      expect(await validateReceiptContent(new File([header], "photo.heic", { type: "image/heic" }))).not.toBeNull();
    }
  });
});
