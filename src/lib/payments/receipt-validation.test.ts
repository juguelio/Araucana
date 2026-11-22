import { describe, expect, it } from "vitest";
import { receiptAccept, receiptMissingFileMessage, receiptUploadConfig, validateReceiptContent, validateReceiptFile } from "./receipt-validation";

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
    expect(validateReceiptFile(fileWithSize(10 * 1024 * 1024 + 1))).toBe("El comprobante pesa más de 10 MB. Comprimí la foto o mandalo como PDF más liviano.");
  });

  it.each(["image/heic", "image/heif", "", "application/octet-stream"])("allows an iPhone photo with MIME %s", (type) => {
    expect(validateReceiptFile(new File(["photo"], "IMG_0001.HEIC", { type }))).toBeNull();
  });

  it("does not allow arbitrary files with missing or generic MIME", () => {
    for (const type of ["", "application/octet-stream"]) {
      expect(validateReceiptFile(new File(["x"], "file.exe", { type }))).toMatch(/no se puede adjuntar/);
    }
    expect(receiptAccept).toContain("image/heic");
    expect(receiptAccept).toContain(".heif");
  });

  // Criterio del issue #288: si el archivo no se puede usar, el mensaje dice **qué hacer**,
  // no sólo qué formatos se aceptan. El admin no tiene a quién preguntarle en ese momento.
  it("every rejection tells the operator what to do, not just which formats exist", () => {
    const rejections = [
      validateReceiptFile(fileWithSize(0)),
      validateReceiptFile(fileWithSize(10 * 1024 * 1024 + 1)),
      validateReceiptFile(new File(["x"], "comprobante.docx", { type: "application/msword" })),
      receiptMissingFileMessage
    ];
    for (const message of rejections) {
      expect(message).toBeTruthy();
      expect(message).toMatch(/PDF|JPG/);
      expect(message).not.toMatch(/^Subi un comprobante valido\.?$/);
    }
  });

  it("explains a corrupted file instead of blaming the MIME type", async () => {
    const pdfQueNoEsPdf = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], "comprobante.pdf", { type: "application/pdf" });
    expect(await validateReceiptContent(pdfQueNoEsPdf)).toBe(
      "No pudimos abrir el archivo como comprobante: puede estar dañado o tener otro formato adentro. Volvé a mandarlo como PDF, JPG o PNG."
    );
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
