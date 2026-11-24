export const specialTripsPath = "/admin/viajes-especiales";

export type SpecialTripsView = "calendario" | "listado";

export function specialTripsViewFor(get: (key: string) => unknown): SpecialTripsView {
  // Los enlaces guardados al listado ya llevaban estos filtros antes de agregar las pestañas.
  const listFilters = ["vista", "mes", "pagina", "orden", "dir"];
  return get("modo") === "listado" || listFilters.some((key) => {
    const value = get(key);
    return typeof value === "string" && Boolean(value.trim());
  }) ? "listado" : "calendario";
}

export function specialTripsViewHref(view: SpecialTripsView, get: (key: string) => unknown) {
  const query = new URLSearchParams();
  if (view === "listado") query.set("modo", "listado");
  for (const key of ["semana", "q", "estado", "nave"]) {
    const value = get(key);
    if (typeof value === "string" && value.trim()) query.set(key, value.trim());
  }
  const path = view === "calendario" ? `${specialTripsPath}/semana` : specialTripsPath;
  return query.size ? `${path}?${query}` : path;
}
