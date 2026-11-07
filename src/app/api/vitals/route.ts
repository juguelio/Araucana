import { webVitalSchema } from "@/lib/observability/vitals";

/**
 * Métricas de usuarios reales (Core Web Vitals) que manda el navegador con sendBeacon.
 * Sólo se escriben en el log de Vercel como JSON (evento web_vital): sin base, sin terceros,
 * sin ids ni datos personales (la ruta llega ya limpia y se valida).
 */
export async function POST(request: Request) {
  const raw = await request.text().catch(() => "");
  if (raw.length > 2_000) return new Response(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = webVitalSchema.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });
  const { name, value, rating, route } = parsed.data;
  console.info(JSON.stringify({ evento: "web_vital", name, value: Math.round(value * 100) / 100, rating, route }));
  return new Response(null, { status: 204 });
}
