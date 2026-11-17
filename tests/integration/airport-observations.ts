/**
 * Regresión PostgreSQL real del registro de observaciones (no corre con npm test).
 * Preparar una base descartable con las migraciones y ejecutar:
 * E2E_ISOLATED_DATABASE=1 DATABASE_URL=<postgres local *_test> npx tsx tests/integration/airport-observations.ts
 * No carga .env, no migra y sólo borra sus propias fixtures.
 */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db/prisma";
import { unificarFilasDeVuelo } from "../../src/lib/airport/flight-merge";
import { guardarObservaciones, type ObservacionPendiente } from "../../src/lib/airport/observations";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(process.env.E2E_ISOLATED_DATABASE === "1", "Requiere E2E_ISOLATED_DATABASE=1");
  assert(["localhost", "127.0.0.1"].includes(url.hostname), "Sólo Postgres local");
  assert(/(?:_test|_e2e)$/.test(url.pathname), "El nombre de la base debe terminar en _test o _e2e");

  const n = randomInt(1000, 9999);
  const scheduledAt = new Date("2030-11-16T16:00:00Z");
  const ja = await prisma.flight.create({ data: { number: `JA${n}`, airline: "JA", origin: "AEP", direction: "ARRIVAL", scheduledAt, source: "FIDS" } });
  const wj = await prisma.flight.create({ data: { number: `WJ${n}`, airline: "WJ", origin: "AEP", direction: "ARRIVAL", scheduledAt: new Date(scheduledAt.getTime() + 60000), source: "API" } });
  const borrada = await prisma.flight.create({ data: { number: `AR${n}`, origin: "AEP", direction: "ARRIVAL", scheduledAt, source: "ESTIMADO" } });
  await prisma.flight.delete({ where: { id: borrada.id } });
  const runId = randomUUID();

  try {
    const base = (over: Partial<ObservacionPendiente>): ObservacionPendiente => ({
      source: "API", direction: "ARRIVAL", rawNumber: `WJ${n}`, codeshareOf: null, airline: "WJ", origin: "AEP",
      scheduledAt, estimatedAt: null, status: "SCHEDULED", rawStatus: "scheduled", localDay: null, dayInferred: false,
      payload: { flight_iata: `WJ${n}` }, outcome: "ACTUALIZADO", flightId: wj.id, ...over
    });

    const r = await guardarObservaciones(runId, [
      base({}),
      // una fila borrada en la misma corrida no rompe el lote por la FK
      base({ rawNumber: `AR${n}`, airline: "AR", flightId: borrada.id })
    ]);
    assert.equal(r.registradas, 2);
    const guardadas = await prisma.flightObservation.findMany({ where: { syncRunId: runId }, orderBy: { rawNumber: "asc" } });
    const deAr = guardadas.find((o) => o.rawNumber === `AR${n}`)!;
    const deWj = guardadas.find((o) => o.rawNumber === `WJ${n}`)!;
    assert.equal(deAr.flightId, null);
    assert.equal(deWj.flightId, wj.id);
    // JA y WJ del mismo vuelo el mismo día: el asociador lo marca como repetido
    assert.equal(deWj.matchLevel, "AMBIGUO");
    assert.match(deWj.discrepancy ?? "", /2 filas/);
    assert.equal(deWj.canonicalNumber, `JA${n}`);
    assert.deepEqual(deWj.payload, { flight_iata: `WJ${n}` });

    // la unificación borra la WJ y la lectura pasa a la JA que queda (no queda huérfana por SetNull)
    const { borrados } = await unificarFilasDeVuelo([ja.id, wj.id], [wj.id]);
    assert.equal(borrados, 1);
    const despues = await prisma.flightObservation.findUnique({ where: { id: deWj.id } });
    assert.equal(despues?.flightId, ja.id);

    // borrar un vuelo directo deja la lectura con flightId nulo, no la borra
    await prisma.flight.delete({ where: { id: ja.id } });
    const huerfana = await prisma.flightObservation.findUnique({ where: { id: deWj.id } });
    assert.equal(huerfana?.flightId, null);

    console.log("airport-observations: OK");
  } finally {
    await prisma.flightObservation.deleteMany({ where: { syncRunId: runId } });
    await prisma.flight.deleteMany({ where: { id: { in: [ja.id, wj.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
