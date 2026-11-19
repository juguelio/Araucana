/**
 * Volver al listado con un aviso, conservando los filtros con los que se venía (19-nov): validar
 * varios comprobantes seguidos no puede obligar a rearmar la cola después de cada uno.
 *
 * El `query` sale del `listQuery` que mandan los formularios del listado, nunca de la URL.
 */
export function reservationNotice(path: string, message: string, query = "") {
  const params = new URLSearchParams(query);
  params.set("notice", message);
  const target = path === "/admin/reservas" && params.get("vista") === "reservas" ? "/admin" : path;
  return `${target}?${params.toString()}`;
}
