import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(process.cwd(), "src/app");

function readAppFile(path: string) {
  return readFileSync(join(appDir, path), "utf8");
}

/**
 * Los links de alta intención llevan `prefetch`: el idioma se resuelve con
 * `localizePath`, así que se verifica la navegación del header y la CTA de reserva.
 */
describe("high intent route prefetching", () => {
  it("prefetches primary route entry points from the global navigation", () => {
    const source = readAppFile("layout.tsx");

    expect(source).toContain('localizePath(link.href, locale)');
    expect(source).toContain("prefetch={true}");
    expect(source).toContain('localizePath("/rutas", locale)');
  });

  it("prefetches route selection links from the home page", () => {
    const source = readAppFile("page.tsx");

    expect(source).toContain('const home = (path: string) => localizePath(path, locale)');
    expect(source).toContain('href={home("/rutas")} prefetch={true}');
    expect(source).toContain('className="chapelco-section page-shell"');
    expect(source).toContain("prefetch={true}");
  });

  it("prefetches dynamic route cards and reservation CTAs", () => {
    expect(readAppFile("rutas/page.tsx")).toContain("prefetch={true}");
    expect(readAppFile("rutas/[slug]/page.tsx")).toContain('<Link className="cream-button" href={`/reservar/${route.slug}`} prefetch={true}>');
    expect(readAppFile("cruce-a-chile/page.tsx")).toContain("prefetch={true}");
  });
});
