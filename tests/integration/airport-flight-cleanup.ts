/**
 * Regresión PostgreSQL real (no corre con npm test).
 * Preparar una base descartable con las migraciones y ejecutar:
 * E2E_ISOLATED_DATABASE=1 DATABASE_URL=<postgres local *_test> npx tsx tests/integration/airport-flight-cleanup.ts
 * No carga .env, migra ni borra datos ajenos a sus propias fixtures.
 */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient, type Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/db/prisma";
import { deleteUnoccupiedFlight } from "../../src/lib/airport/flight-cleanup";
import { unificarFilasDeVuelo } from "../../src/lib/airport/flight-merge";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(process.env.E2E_ISOLATED_DATABASE === "1", "Requiere E2E_ISOLATED_DATABASE=1");
  assert(["localhost", "127.0.0.1"].includes(url.hostname), "Sólo Postgres local");
  assert(/(?:_test|_e2e)$/.test(url.pathname), "El nombre de la base debe terminar en _test o _e2e");
  const writer = new PrismaClient();
  const flightIds: string[] = [], reservationIds: string[] = [], passengerIds: string[] = [], vehicleIds: string[] = [];
  const checks: string[] = [];
  const flight = async () => {
    const f = await prisma.flight.create({ data: {
      number: `WJ${randomInt(100000, 999999)}`, origin: "PRUEBA AISLADA", direction: "ARRIVAL",
      scheduledAt: new Date("2030-11-16T16:00:00Z"), source: "MANUAL"
    } });
    flightIds.push(f.id);
    return f;
  };
  const passenger = await prisma.passenger.create({ data: {
    firstName: "Prueba", lastName: "Concurrencia", email: "fixture@example.test", phone: "0",
    documentType: "DNI", documentId: randomUUID()
  } });
  passengerIds.push(passenger.id);
  const createReservation = async (tx: Prisma.TransactionClient, f: { id: string; number: string; scheduledAt: Date }, status = "CONFIRMED") => {
    const r = await tx.reservation.create({ data: {
      code: `RACE-${randomUUID()}`, passengerId: passenger.id, passengerCount: 1, bookingMode: "AIRPORT", status, totalCents: 1,
      airportDetails: { create: { flightId: f.id, flightNumber: f.number, direction: "ARRIVAL", serviceDate: f.scheduledAt } }
    } });
    reservationIds.push(r.id);
    return r;
  };
  async function race(flightId: string, createRelation: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    let release!: () => void, ready!: () => void, failed!: (error: unknown) => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inserted = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
    const write = writer.$transaction(async (tx) => {
      await createRelation(tx); ready(); await gate;
    }, { timeout: 15000 }).catch((error) => { failed(error); throw error; });
    let cleanup: Promise<number> | undefined;
    try {
      await inserted;
      cleanup = deleteUnoccupiedFlight(flightId);
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const rows = await writer.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`;
        if (rows.length > 0) { blocked = true; break; }
        await delay(20);
      }
      assert(blocked, "La limpieza debe esperar la FK de la relación sin confirmar");
      release(); await write;
      assert.equal(await cleanup, 0, "La fila queda protegida al confirmar la relación");
      assert(await prisma.flight.findUnique({ where: { id: flightId } }));
    } finally {
      release(); await Promise.allSettled([write, ...(cleanup ? [cleanup] : [])]);
    }
  }
  try {
    const f = await flight();
    assert.equal(await deleteUnoccupiedFlight(f.id), 1);
    assert.equal(await deleteUnoccupiedFlight(f.id), 0);
    checks.push("borrado vacío e idempotencia");

    const reserved = await flight();
    let reservationId = "";
    await race(reserved.id, async (tx) => { reservationId = (await createReservation(tx, reserved)).id; });
    assert.equal((await prisma.airportReservationDetails.findUniqueOrThrow({ where: { reservationId } })).flightId, reserved.id);
    checks.push("reserva concurrente conserva el vuelo y su FK");

    const assigned = await flight();
    const vehicle = await prisma.vehicle.create({ data: { name: "Fixture concurrencia" } });
    vehicleIds.push(vehicle.id);
    await race(assigned.id, (tx) => tx.airportVehicleAssignment.create({ data: { flightId: assigned.id, vehicleId: vehicle.id } }));
    assert.equal(await prisma.airportVehicleAssignment.count({ where: { flightId: assigned.id, vehicleId: vehicle.id } }), 1);
    checks.push("combi concurrente conserva el vuelo y la asignación");

    const cancelled = await flight();
    await createReservation(prisma, cancelled, "CANCELLED");
    assert.equal(await deleteUnoccupiedFlight(cancelled.id), 0);
    checks.push("también protege reservas canceladas vinculadas");

    // La fila repetida que se descarta puede saber más que la que sobrevive: el tablero tiene el
    // vuelo cancelado, el horario nuevo y una nota, mientras la reservada quedó en la proyección.
    const numero = randomInt(100000, 999999);
    const reservada = await prisma.flight.create({ data: {
      number: `WJ${numero}`, origin: "AEP", direction: "ARRIVAL", source: "ESTIMADO", status: "SCHEDULED",
      scheduledAt: new Date("2030-11-13T11:00:00-03:00")
    } });
    flightIds.push(reservada.id);
    const tablero = await prisma.flight.create({ data: {
      number: `JA${numero}`, origin: "AEP", direction: "ARRIVAL", source: "FIDS", status: "CANCELLED",
      scheduledAt: new Date("2030-11-13T13:25:00-03:00"), notes: "Cancelado por el tablero",
      pickupStartOverrideAt: new Date("2030-11-13T12:00:00-03:00")
    } });
    flightIds.push(tablero.id);
    await prisma.flightEvent.create({ data: {
      flightId: tablero.id, kind: "CANCELLED", fromValue: "SCHEDULED", toValue: "CANCELLED"
    } });
    const reservaConVuelo = await createReservation(prisma, reservada);
    const resultado = await unificarFilasDeVuelo([reservada.id, tablero.id], [tablero.id]);
    assert.deepEqual(resultado, { borrados: 1, eventos: 1 });
    assert.equal(await prisma.flight.findUnique({ where: { id: tablero.id } }), null);
    const conservada = await prisma.flight.findUniqueOrThrow({ where: { id: reservada.id } });
    assert.equal(conservada.status, "CANCELLED");
    assert.equal(conservada.source, "FIDS");
    assert.equal(conservada.scheduledAt.toISOString(), new Date("2030-11-13T13:25:00-03:00").toISOString());
    assert.equal(conservada.notes, "Cancelado por el tablero");
    assert.ok(conservada.pickupStartOverrideAt);
    const eventosConservados = await prisma.flightEvent.findMany({ where: { flightId: reservada.id } });
    assert.equal(eventosConservados.length, 1);
    assert.equal(eventosConservados[0].kind, "CANCELLED");
    assert.equal(eventosConservados[0].toValue, "CANCELLED");
    assert.equal((await prisma.airportReservationDetails.findUniqueOrThrow({ where: { reservationId: reservaConVuelo.id } })).flightId, reservada.id);
    checks.push("unificar conserva estado, horario, notas y eventos de la fila descartada");

    // Y al revés: los datos escritos a mano en la fila que queda no se pisan con una proyección.
    const manual = await prisma.flight.create({ data: {
      number: `WJ${numero + 1}`, origin: "AEP", direction: "ARRIVAL", source: "MANUAL", status: "SCHEDULED",
      scheduledAt: new Date("2030-11-14T09:00:00-03:00"), notes: "Nota cargada por la oficina"
    } });
    flightIds.push(manual.id);
    const proyectada = await prisma.flight.create({ data: {
      number: `JA${numero + 1}`, origin: "AEP", direction: "ARRIVAL", source: "ESTIMADO", status: "SCHEDULED",
      scheduledAt: new Date("2030-11-14T09:00:00-03:00"), notes: "Patrón proyectado"
    } });
    flightIds.push(proyectada.id);
    // La MANUAL gana tanto como superviviente como por autoridad: sólo se borra la proyección.
    assert.deepEqual(await unificarFilasDeVuelo([manual.id, proyectada.id], [proyectada.id]), { borrados: 1, eventos: 0 });
    const manualFinal = await prisma.flight.findUniqueOrThrow({ where: { id: manual.id } });
    assert.equal(manualFinal.notes, "Nota cargada por la oficina");
    assert.equal(manualFinal.source, "MANUAL");
    checks.push("una nota cargada a mano no se pierde al unificar");
    console.log(JSON.stringify({ success: true, checks, total: checks.length }, null, 2));
  } finally {
    await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
    await prisma.airportVehicleAssignment.deleteMany({ where: { flightId: { in: flightIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: flightIds } } });
    await prisma.passenger.deleteMany({ where: { id: { in: passengerIds } } });
    await prisma.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
    await writer.$disconnect();
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
