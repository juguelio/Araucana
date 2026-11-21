import { writeFileSync } from "node:fs";
import { municipalLodgings, municipalLodgingSuggestion } from "../src/lib/airport/lodging-catalogue";
import { getVerifiedLodgingLocation } from "../src/lib/airport/lodging-locations";

const rows = municipalLodgings.map((lodging) => ({ ...lodging, location: getVerifiedLodgingLocation(lodging) }));
const mapped = rows.filter((row) => row.location);
const counts = { total: rows.length, establishment: mapped.filter((row) => row.location!.locationMatch === "establishment").length,
  address: mapped.filter((row) => row.location!.precision === "interpolated").length,
  area: mapped.filter((row) => row.location!.precision === "street").length, pending: rows.length - mapped.length };
for (const row of rows) {
  const suggestion = municipalLodgingSuggestion(row);
  if (Boolean(suggestion.point) !== Boolean(row.location)) throw new Error(`Referencia no seleccionable: ${row.id}`);
}
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const status = (row: typeof rows[number]) => !row.location ? "Pendiente de ubicación" : row.location.precision === "street" ? "Zona / acceso aproximado" : row.location.locationMatch === "address" ? "Domicilio aproximado" : "Establecimiento";
writeFileSync("docs/data/sma-lodging-map-audit.json", JSON.stringify({ checkedOn: "2026-11-20", counts, lodgings: rows.map((row) => ({ ...row, status: status(row) })) }, null, 2) + "\n");
writeFileSync("docs/relevamiento-mapa-alojamientos-sma-2026-11-20.html", `<!doctype html><html lang="es"><meta charset="utf-8"><title>Ubicación de alojamientos SMA</title><style>body{font:16px system-ui;margin:40px;color:#193c32}h1{font-size:30px}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}th{background:#eaf1ec}a{color:#19614c}</style><h1>Alojamientos de San Martín de los Andes · mapa</h1><p>Revisión del 20/11/2026: ${counts.total} fichas municipales; ${mapped.length} referencias seleccionables (${counts.establishment} establecimientos, ${counts.address} domicilios aproximados, ${counts.area} referencias de zona/acceso); ${counts.pending} pendientes.</p><p>La selección conserva nombre y domicilio municipal, muestra el marcador y exige confirmar la entrada. No se utilizaron centros de visor como coordenadas. Los puntos fuera de cobertura siguen sujetos a las reglas del traslado. El catálogo incluye campings y áreas diurnas de la región; no representa todos los alquileres privados no registrados.</p><p>Los enlaces originales que apuntaban a otro alojamiento, a una calle o al centro de la ciudad se revisaron antes de asignar puntos. No se confunden unidades de un edificio con entradas verificadas. Los pendientes conservan la opción de marcar el punto manualmente.</p><table><thead><tr><th>Alojamiento</th><th>Dirección municipal</th><th>Estado</th><th>Evidencia</th></tr></thead><tbody>${rows.map((row) => `<tr><td><a href="${escape(row.sourceUrl)}">${escape(row.name)}</a><br>${escape(row.type)}</td><td>${escape(row.address)}</td><td>${status(row)}</td><td>${row.location ? `<a href="${escape(row.location.sourceUrl)}">Ver ubicación</a><br>${escape(row.location.evidence)}<br>${row.location.point.join(", ")}` : "Sin referencia suficiente para asignar un punto. Requiere confirmar acceso con el alojamiento."}</td></tr>`).join("")}</tbody></table></html>`);
console.log(counts);
