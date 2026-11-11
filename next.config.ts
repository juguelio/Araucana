import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // El listado de planillas se eliminó: la planilla se genera desde la reserva del pasajero.
      // Los bookmarks y links viejos a /admin/planillas no tienen que morir en un 404.
      {
        source: "/admin/planillas",
        destination: "/admin/reservas?notice=La%20planilla%20se%20genera%20desde%20la%20reserva%20del%20pasajero",
        permanent: false
      }
    ];
  },
  async headers() {
    return [
      // Videos e imágenes de /public: sin esto el navegador revalida cada archivo en cada visita.
      // Un día de caché + revalidación en segundo plano; si se reemplaza un archivo, conviene nombre nuevo.
      { source: "/:file(.*\\.(?:mp4|webp|png|jpe?g|svg|ico))", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      { source: "/reservas/:code", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/planilla/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/api/v1/reservations/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" }] }
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb"
    }
  },
  turbopack: {
    root: projectRoot
  }
};

export default nextConfig;
