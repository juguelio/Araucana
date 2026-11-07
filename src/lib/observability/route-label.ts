// Sin dependencias: lo importa el componente cliente de Web Vitals (no meter zod en el bundle del navegador).
/**
 * Ruta sin datos de nadie: los códigos de reserva son el enlace privado del pasajero y los ids
 * de panel no aportan a la métrica. "/reservas/ARC-…" → "/reservas/:codigo".
 */
export function rutaSinIds(pathname: string): string {
  const limpio = pathname.split("?")[0].split("#")[0] || "/";
  return limpio
    .replace(/^\/reservas\/[^/]+/, "/reservas/:codigo")
    .replace(/^\/admin\/reservas\/(?!nueva(?:\/|$))[^/]+/, "/admin/reservas/:codigo")
    .replace(/^\/admin\/(rutas|naves|choferes|secretarias|usuarios)\/(?!nueva(?:\/|$))[^/]+/, "/admin/$1/:id")
    .replace(/\/salidas\/(?!nueva(?:\/|$))[^/]+/, "/salidas/:id")
    .replace(/\b(?:ARC|TKT)-[A-Z0-9-]+/gi, ":codigo")
    .slice(0, 120);
}
