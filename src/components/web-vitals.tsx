"use client";

import { useReportWebVitals } from "next/web-vitals";
import { rutaSinIds } from "@/lib/observability/route-label";

/** Manda LCP, INP, CLS, FCP y TTFB de cada visita a /api/vitals (ver esa ruta). */
export function WebVitals() {
  useReportWebVitals((metric) => {
    const body = JSON.stringify({ name: metric.name, value: metric.value, rating: metric.rating, route: rutaSinIds(window.location.pathname), navigationType: metric.navigationType });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/vitals", new Blob([body], { type: "application/json" }));
    else void fetch("/api/vitals", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } });
  });
  return null;
}
