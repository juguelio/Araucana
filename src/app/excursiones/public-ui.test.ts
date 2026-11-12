import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notFound } from "next/navigation";
import { ServicesGrid } from "@/components/services-grid";
import { getI18n } from "@/i18n/server";
import { getDictionary } from "@/i18n/dictionaries";
import { LOCALES, localizePath } from "@/i18n/config";
import { getPublicExcursion, listPublicExcursions } from "@/lib/excursions/repository";
import { formatExcursionDate } from "@/lib/excursions/validation";
import ExcursionsPage, { dynamic as catalogRendering } from "./page";
import ExcursionDetailPage, { dynamic as detailRendering } from "./[id]/page";

vi.mock("@/i18n/server", () => ({ getI18n: vi.fn() }));
vi.mock("@/lib/excursions/repository", () => ({
  listPublicExcursions: vi.fn(),
  getPublicExcursion: vi.fn()
}));
vi.mock("@/components/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/service-card-video", () => ({ ServiceCardVideo: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, prefetch: _prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => createElement("a", props, children)
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); })
}));

const now = new Date("2026-11-12T15:00:00.000Z");
const departureAt = new Date("2026-12-02T01:30:00.000Z"); // 1 de diciembre en Argentina.

function excursion() {
  return {
    id: "excursion-1",
    name: "Senderos & lagos",
    description: "Descripción original del cliente.\nPunto de encuentro a confirmar.",
    duration: "Medio día",
    priceCents: 123456,
    currency: "ARS",
    isPublished: true,
    createdAt: now,
    updatedAt: now,
    photos: [{ id: "photo-1", excursionId: "excursion-1", position: 0, contentType: "image/webp", blobPathname: "private/path.webp", createdAt: now }],
    departures: [{ id: "departure-1", excursionId: "excursion-1", departureAt, createdAt: now }]
  };
}

const detail = () => ExcursionDetailPage({ params: Promise.resolve({ id: "excursion-1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.mocked(getI18n).mockResolvedValue({ locale: "es", dict: getDictionary("es") });
  vi.mocked(listPublicExcursions).mockResolvedValue([excursion()]);
  vi.mocked(getPublicExcursion).mockResolvedValue(excursion());
});
afterEach(() => vi.useRealTimers());

describe("catálogo público de excursiones", () => {
  it("consulta al repositorio público con el instante actual, sin cachear la vidriera", async () => {
    expect(catalogRendering).toBe("force-dynamic");
    expect(detailRendering).toBe("force-dynamic");
    await ExcursionsPage();
    await detail();
    expect(listPublicExcursions).toHaveBeenCalledWith(now);
    expect(getPublicExcursion).toHaveBeenCalledWith("excursion-1", now);
  });

  it.each(LOCALES)("muestra contenido original, fechas argentinas y detalle localizado en %s", async (locale) => {
    vi.mocked(getI18n).mockResolvedValue({ locale, dict: getDictionary(locale) });
    const html = renderToStaticMarkup(await ExcursionsPage());
    expect(html).toContain("Senderos &amp; lagos");
    expect(html).toContain("Descripción original del cliente.");
    expect(html).toContain("Medio día");
    expect(html).toContain(formatExcursionDate(departureAt, locale));
    expect(html).toContain(`href="${localizePath("/excursiones/excursion-1", locale)}"`);
    expect(html).toContain('src="/excursiones/fotos/photo-1"');
    expect(html).not.toContain("private/path.webp");
    expect(html).not.toContain("/reservar/");
    expect(html).toContain({ es: "Próximas salidas", en: "Upcoming departures", pt: "Próximas saídas" }[locale]);
  });

  it.each(LOCALES)("responde con un estado vacío amable en %s sin inventar excursiones", async (locale) => {
    vi.mocked(getI18n).mockResolvedValue({ locale, dict: getDictionary(locale) });
    vi.mocked(listPublicExcursions).mockResolvedValue([]);
    const html = renderToStaticMarkup(await ExcursionsPage());
    expect(html).toContain({
      es: "Estamos preparando nuevas excursiones.",
      en: "We’re preparing new excursions.",
      pt: "Estamos preparando novas excursões."
    }[locale]);
    expect(html).toContain("https://wa.me/");
    expect(html).not.toContain("/excursiones/excursion-1");
    expect(html).not.toContain("/reservar/");
  });

  it("excluye salidas pasadas incluso ante un resultado desactualizado y conserva el límite exacto", async () => {
    const data = excursion();
    data.departures = [
      { ...data.departures[0], id: "past", departureAt: new Date("2026-11-12T14:59:59.999Z") },
      { ...data.departures[0], id: "boundary", departureAt: now },
      ...data.departures
    ];
    vi.mocked(listPublicExcursions).mockResolvedValue([data]);
    vi.mocked(getPublicExcursion).mockResolvedValue(data);
    for (const page of [await ExcursionsPage(), await detail()]) {
      const html = renderToStaticMarkup(page);
      expect(html).not.toContain('dateTime="2026-11-12T14:59:59.999Z"');
      expect(html).toContain(`dateTime="${now.toISOString()}"`);
      expect(html).toContain(`dateTime="${departureAt.toISOString()}"`);
    }
  });

  it("resume tres fechas en la tarjeta y permite acceder a todas en el detalle", async () => {
    const data = excursion();
    data.departures = Array.from({ length: 5 }, (_, index) => ({
      ...data.departures[0], id: `departure-${index}`, departureAt: new Date(`2026-12-0${index + 1}T15:00:00.000Z`)
    }));
    vi.mocked(listPublicExcursions).mockResolvedValue([data]);
    vi.mocked(getPublicExcursion).mockResolvedValue(data);
    const catalog = renderToStaticMarkup(await ExcursionsPage());
    const page = renderToStaticMarkup(await detail());
    expect(catalog.match(/<time /g)).toHaveLength(3);
    expect(catalog).toContain('href="/excursiones/excursion-1#salidas"');
    expect(catalog).toContain("Ver todas las fechas");
    expect(page.match(/<time /g)).toHaveLength(5);
  });

  it("conserva el catálogo aunque una excursión todavía no tenga salidas ni fotos", async () => {
    vi.mocked(listPublicExcursions).mockResolvedValue([{ ...excursion(), photos: [], departures: [], priceCents: null }]);
    const html = renderToStaticMarkup(await ExcursionsPage());
    expect(html).toContain("Senderos &amp; lagos");
    expect(html).toContain("Consultanos por las próximas fechas.");
    expect(html).toContain("Consultar precio");
    expect(html).not.toContain("<img");
  });
});

describe("detalle público de excursión", () => {
  it.each(LOCALES)("muestra galería, precio exacto, próximas fechas y consulta sin reserva en %s", async (locale) => {
    vi.mocked(getI18n).mockResolvedValue({ locale, dict: getDictionary(locale) });
    const html = renderToStaticMarkup(await detail());
    expect(html).toContain(`href="${localizePath("/excursiones", locale)}"`);
    expect(html).toContain("Medio día");
    const price = new Intl.NumberFormat({ es: "es-AR", en: "en", pt: "pt-BR" }[locale], { style: "currency", currency: "ARS", currencyDisplay: "code" }).format(123456 / 100);
    expect(html).toContain(price);
    expect(html).toContain(formatExcursionDate(departureAt, locale));
    expect(html).toContain(`dateTime="${departureAt.toISOString()}"`);
    expect(html).toContain('src="/excursiones/fotos/photo-1"');
    expect(html).not.toContain("private/path.webp");
    expect(html).not.toContain("/reservar/");
    expect(html).not.toContain("<form");

    const whatsappLinks = [...html.matchAll(/href="(https:\/\/wa\.me\/[^\"]+)"/g)].map((match) => new URL(match[1].replaceAll("&amp;", "&")));
    expect(whatsappLinks.length).toBeGreaterThan(0);
    expect(whatsappLinks.some((url) => url.searchParams.get("text")?.includes("Senderos & lagos"))).toBe(true);
    expect(whatsappLinks.some((url) => url.searchParams.get("text")?.includes(formatExcursionDate(departureAt, locale)))).toBe(true);
    const home = readFileSync("src/app/page.tsx", "utf8");
    const realPhone = home.match(/const whatsappUrl = "https:\/\/wa\.me\/(\d+)"/)?.[1];
    expect(realPhone).toMatch(/^\d+$/);
    for (const url of whatsappLinks) expect(url.pathname).toBe(`/${realPhone}`);
  });

  it("no publica un precio inventado ni una galería rota cuando faltan datos opcionales", async () => {
    vi.mocked(getPublicExcursion).mockResolvedValue({ ...excursion(), priceCents: null, photos: [], departures: [] });
    const html = renderToStaticMarkup(await detail());
    expect(html).toContain("Consultar precio");
    expect(html).toContain("Consultanos por las próximas fechas.");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("ARS");
  });

  it("muestra cero como precio informado, no como dato faltante", async () => {
    vi.mocked(getPublicExcursion).mockResolvedValue({ ...excursion(), priceCents: 0 });
    const html = renderToStaticMarkup(await detail());
    expect(html).toContain("ARS");
    expect(html).not.toContain("Consultar precio");
  });

  it("retorna 404 cuando el repositorio oculta un borrador o no encuentra la excursión", async () => {
    vi.mocked(getPublicExcursion).mockResolvedValue(null);
    await expect(detail()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});

describe("acceso desde servicios de la home", () => {
  it.each(LOCALES)("abre el catálogo interno en %s y conserva los otros destinos", async (locale) => {
    const dict = getDictionary(locale);
    vi.mocked(getI18n).mockResolvedValue({ locale, dict });
    const services = dict.services.items.map((item, index) => ({
      number: `0${index + 1}`, title: item.title, text: item.text, cta: dict.services.ask,
      href: `https://example.com/service-${index + 1}`, tone: "service-green"
    }));
    const html = renderToStaticMarkup(await ServicesGrid({ services }));
    expect(html).toContain(`href="${localizePath("/excursiones", locale)}"`);
    expect(html).not.toContain("https://example.com/service-3");
    expect(html).toContain("https://example.com/service-2");
    expect(html).toContain("https://example.com/service-4");
    const excursionAnchor = html.match(new RegExp(`<a[^>]*href="${localizePath("/excursiones", locale)}"[^>]*>`))?.[0];
    expect(excursionAnchor).toBeDefined();
    expect(excursionAnchor).not.toContain("target=");
  });
});
