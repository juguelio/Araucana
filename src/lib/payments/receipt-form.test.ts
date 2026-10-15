import { describe, expect, it } from "vitest";
import { MAX_RECEIPT_REQUEST_BYTES, readReceiptFormData } from "./receipt-form";
import { validateReceiptContent } from "./receipt-validation";

describe("receipt input security", () => {
  it("rejects fake PDF content and MIME mismatches", async () => {
    expect(await validateReceiptContent(new File(["fake"], "x.pdf", { type: "application/pdf" }))).not.toBeNull();
    expect(await validateReceiptContent(new File(["%PDF-1.7"], "x.png", { type: "image/png" }))).not.toBeNull();
    expect(await validateReceiptContent(new File(["%PDF-1.7"], "x.pdf", { type: "application/pdf" }))).toBeNull();
  });
  it("accepts multipart data within the limit", async () => {
    const data = new FormData(); data.set("receipt", new File(["%PDF-1.7"], "x.pdf", { type: "application/pdf" }));
    const parsed = await readReceiptFormData(new Request("http://localhost", { method: "POST", body: data }));
    expect(parsed.get("receipt")).toBeInstanceOf(File);
  });
  it("bounds actual streamed bytes even when content-length is missing", async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_RECEIPT_REQUEST_BYTES + 1)); controller.close(); } });
    const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readReceiptFormData(request)).rejects.toMatchObject({ status: 413 });
  });
  it("returns a validation error for malformed multipart", async () => {
    await expect(readReceiptFormData(new Request("http://localhost", { method: "POST", body: "oops" }))).rejects.toMatchObject({ status: 400 });
  });
});
