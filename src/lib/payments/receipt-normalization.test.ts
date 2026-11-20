import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeReceipt } from "./receipt-normalization";
import { validateReceiptContent } from "./receipt-validation";

// Imagen sintética de 64 × 64, codificada en HEIC con sips (macOS); sin datos de pasajeros.
const heic = readFileSync(new URL("./fixtures/receipt.heic", import.meta.url));
const photo = (type = "image/heic", name = "IMG_1234.HEIC") => new File([heic], name, { type });

describe("comprobantes HEIC de iPhone", () => {
  it.each(["image/heic", "image/heif", "", "application/octet-stream"])("convierte un HEIC real (%s) a un JPG legible", async (type) => {
    const converted = await normalizeReceipt(photo(type));
    expect(converted.name).toBe("IMG_1234.jpg");
    expect(converted.type).toBe("image/jpeg");
    expect(new Uint8Array(await converted.slice(0, 3).arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]));
    expect(await validateReceiptContent(converted)).toBeNull();
  });

  it("explica cómo continuar si el contenedor HEIC está dañado", async () => {
    // Conserva una cabecera HEIF válida, pero sin la imagen que tiene que decodificar.
    const broken = new File([heic.subarray(0, heic.readUInt32BE(0))], "dañado.heic", { type: "image/heic" });
    await expect(normalizeReceipt(broken)).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringMatching(/Volvé a elegirla.*JPG o PDF/) });
  });

  it("rechaza otro contenido renombrado HEIC y HEIC renombrado JPG", async () => {
    await expect(normalizeReceipt(new File(["%PDF-1.7"], "foto.heic", { type: "image/heic" }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(normalizeReceipt(photo("image/jpeg", "foto.jpg"))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("aplica también al JPG convertido el límite de tamaño del comprobante", async () => {
    await expect(normalizeReceipt(photo(), 500)).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringMatching(/convertida es demasiado grande/) });
  });

  it("rechaza una foto demasiado grande antes de cargar el decodificador", async () => {
    const oversized = { name: "foto.heic", type: "image/heic", size: 10 * 1024 * 1024 + 1 } as File;
    await expect(normalizeReceipt(oversized)).rejects.toMatchObject({ message: "El comprobante pesa más de 10 MB. Comprimí la foto o mandalo como PDF más liviano." });
  });

  it("conserva PDF y corrige el nombre si Safari ya convirtió la foto a JPEG", async () => {
    const pdf = new File(["%PDF-1.7"], "comprobante.pdf", { type: "application/pdf" });
    expect(await normalizeReceipt(pdf)).toBe(pdf);
    const jpeg = await normalizeReceipt(photo());
    const safariFile = new File([jpeg], "IMG_1234.HEIC", { type: "image/jpeg" });
    const normalized = await normalizeReceipt(safariFile);
    expect(normalized.name).toBe("IMG_1234.jpg");
    expect(await normalized.arrayBuffer()).toEqual(await jpeg.arrayBuffer());
  });
});
