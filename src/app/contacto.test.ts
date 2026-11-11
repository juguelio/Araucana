import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(process.cwd(), "src/app");
const source = (path: string) => readFileSync(join(appDir, path), "utf8");

/**
 * La tarjeta de contacto del home y el footer muestran teléfonos reales: un
 * valor redactado (`tel:+542****0285`) o un número sin `tel:` deja el botón
 * muerto en el celular, y en pantalla se lee el asterisco.
 */
describe("teléfonos de contacto", () => {
  it("el home tiene el teléfono fijo completo y sin redactar", () => {
    const page = source("page.tsx");
    expect(page).toContain('href="tel:+542972420285"');
    expect(page).not.toContain("****");
  });

  it("el footer repite el mismo número", () => {
    const footer = readFileSync(join(process.cwd(), "src/components/site-footer.tsx"), "utf8");
    expect(footer).toContain('href="tel:+542972420285"');
    expect(footer).not.toContain("****");
  });

  it("el botón de WhatsApp apunta al número de la agencia", () => {
    expect(source("page.tsx")).toContain('"https://wa.me/5492944649049"');
  });
});

/**
 * `.contact-card > div:first-child { display:grid }` apila etiqueta y datos. Sin
 * ese primer `div` los textos quedan en línea y se leen pegados
 * ("WhatsApp…↗02972 420285info@…").
 */
describe("tarjeta de contacto del home", () => {
  it("agrupa etiqueta y datos en un contenedor propio", () => {
    const page = source("page.tsx");
    const bloque = page.slice(page.indexOf('className="contact-card"'), page.indexOf('className="socials"'));
    expect(bloque).toContain("<div>");
    expect(bloque.indexOf("<div>")).toBeLessThan(bloque.indexOf("cardTitle"));
  });
});
