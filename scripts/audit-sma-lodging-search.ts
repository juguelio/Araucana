/** Run: npx tsx scripts/audit-sma-lodging-search.ts
 * Resumable live Photon audit. Does not read credentials, write a DB, or run Google.
 * Name agreement is a candidate match, never proof of the pickup entrance.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import catalogue from "../src/lib/airport/data/sma-lodgings.json";
import { municipalLodgings, lodgingNameWords } from "../src/lib/airport/lodging-catalogue";
import { suggestProviderAirportPlaces, type AirportPlaceSuggestion } from "../src/lib/airport/place-suggestions";

const output = new URL("../docs/data/sma-lodging-provider-audit.json", import.meta.url);
type Row = { id: string; query: string; checkedAt: string; status: "name_match" | "review" | "no_results" | "error"; results: AirportPlaceSuggestion[] };
async function main() {
  process.env.AIRPORT_GEOCODER_URL = "";
  process.env.AIRPORT_PHOTON_URL = "https://photon.komoot.io/api/";
  let rows: Row[] = [];
  try {
    const saved = JSON.parse(await readFile(output, "utf8"));
    rows = saved.rows.filter((row: Row) => new Date(row.checkedAt).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Salta" }) === catalogue.retrievedOn);
  } catch { /* first run */ }
  await mkdir(new URL("../docs/data/", import.meta.url), { recursive: true });
  const names = (value: string) => lodgingNameWords(value.split(",")[0]).sort().join(" ");
  for (const lodging of municipalLodgings) {
    if (rows.some((row) => row.id === lodging.id && row.query === lodging.name && row.status !== "error")) continue;
    await pause(1100);
    let results: AirportPlaceSuggestion[] = [];
    let status: Row["status"] = "error";
    try {
      results = await suggestProviderAirportPlaces(lodging.name, AbortSignal.timeout(15000));
      status = results.some((result) => names(result.label) === names(lodging.name))
        ? "name_match" : results.length ? "review" : "no_results";
    } catch { /* record transient failure separately from no matches */ }
    rows = rows.filter((row) => row.id !== lodging.id);
    rows.push({ id: lodging.id, query: lodging.name, checkedAt: new Date().toISOString(), status, results });
    await writeFile(output, JSON.stringify({
      catalogueRetrievedOn: catalogue.retrievedOn, provider: "Photon / OpenStreetMap", endpoint: process.env.AIRPORT_PHOTON_URL,
      attribution: "© OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
      scope: "Nombres oficiales, área restringida del buscador de aeropuerto. Coincidencia nominal automática; dirección y punto requieren revisión. Google y LocationIQ no evaluados: sin credenciales locales.",
      rows
    }, null, 2) + "\n");
    console.log(`${rows.length}/${municipalLodgings.length}: ${lodging.name} — ${status}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
