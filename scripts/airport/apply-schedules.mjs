import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const OFFICIAL = { AR: 'AR_OFICIAL', JA: 'JA_OFICIAL' };
const PUBLISHED = new Set([...Object.values(OFFICIAL), 'ITINERARIO']);
const WITHDRAWN = new Set(['RETIRADO', 'REVISAR']);
const MANAGED = new Set([...PUBLISHED, ...WITHDRAWN, 'ESTIMADO']);
const MUTABLE = [
  'number',
  'airline',
  'origin',
  'destination',
  'source',
  'scheduledAt',
  'lastCheckedAt',
  'externalId',
];
const select = Object.fromEntries(
  [
    ...MUTABLE,
    'id',
    'direction',
    'status',
    'estimatedAt',
    'actualAt',
    'pickupStartInitialAt',
    'pickupStartOverrideAt',
    'pickupGroupId',
    'passengers',
    'notes',
  ].map((k) => [k, true]),
);
select._count = { select: { reservations: true, assignments: true } };
const auditEntity = 'AIRPORT_SCHEDULE_IMPORT';
const withdrawnPrefix = 'HORARIO_RETIRADO@';
const airport = (text) => {
  const s = String(text ?? '')
    .trim()
    .toUpperCase();
  if (s === 'AEP' || s.includes('AEROPARQUE') || /\bAEP\b/.test(s)) return 'AEP';
  if (s === 'EZE' || s.includes('EZEIZA') || /\bEZE\b/.test(s)) return 'EZE';
  if (s === 'CPC' || s.includes('CHAPELCO') || /\bCPC\b/.test(s)) return 'CPC';
  return null;
};
const localDate = (date) => new Date(new Date(date).getTime() - 3 * 3600000).toISOString().slice(0, 10);
const iso = (date) => (date == null ? null : new Date(date).toISOString());
const key = (day, direction, number) => `${day}|${direction}|${number}`;
const isBuenosAires = (code) => code === 'AEP' || code === 'EZE';
function canonical(number) {
  const m = /^(AR|JA|WJ)\s*(\d{1,4})$/i.exec(String(number).trim());
  return m ? (m[1].toUpperCase() === 'WJ' ? 'JA' : m[1].toUpperCase()) + m[2] : null;
}
function requireValue(ok, message) {
  if (!ok) throw new Error(message);
}
function validDate(day) {
  return (
    typeof day === 'string' &&
    /^\d{4}-\d\d-\d\d$/.test(day) &&
    Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day
  );
}
function validateScope(x) {
  requireValue(
    x && validDate(x.date) && ['ARRIVAL', 'DEPARTURE'].includes(x.direction),
    'Fecha o sentido inválido en la programación.',
  );
}
function validateSource(source, carrier) {
  requireValue(source === 'ITINERARIO' || source === OFFICIAL[carrier], `Fuente inválida para ${carrier}.`);
}
function parsePayload(payload, today) {
  requireValue(
    payload && Array.isArray(payload.flights) && Array.isArray(payload.coverage),
    'Se requieren flights y coverage.',
  );
  const coverage = new Map();
  const flights = new Map();
  const dates = new Set();
  for (const c of payload.coverage) {
    validateScope(c);
    requireValue(
      Object.hasOwn(OFFICIAL, c.carrier) &&
        Array.isArray(c.airports) &&
        c.airports.length &&
        c.airports.every(isBuenosAires),
      'Cobertura inválida.',
    );
    const source = c.source ?? (c.carrier === 'AR' ? 'AR_OFICIAL' : 'ITINERARIO');
    validateSource(source, c.carrier);
    if (c.date <= today) continue;
    dates.add(c.date);
    for (const a of c.airports) {
      const k = key(c.date, c.direction, c.carrier) + '|' + a;
      if (coverage.get(k) !== OFFICIAL[c.carrier]) coverage.set(k, source);
    }
  }
  for (const f of payload.flights) {
    validateScope(f);
    const n = canonical(f.number);
    requireValue(n && /^([01]\d|2[0-3]):[0-5]\d$/.test(f.time), 'Número u hora inválidos.');
    const carrier = n.slice(0, 2);
    validateSource(f.source, carrier);
    const other = f.direction === 'ARRIVAL' ? f.origin : f.destination;
    requireValue(
      isBuenosAires(other) && (f.direction === 'ARRIVAL' ? f.destination : f.origin) === 'CPC',
      'El tramo debe ser AEP/EZE–CPC en el sentido indicado.',
    );
    if (f.date <= today) continue;
    dates.add(f.date);
    const identity = key(f.date, f.direction, n);
    const previous = flights.get(identity);
    if (previous && previous.source === f.source) {
      requireValue(
        previous.origin === f.origin && previous.destination === f.destination && previous.time === f.time,
        `Horarios contradictorios para ${identity} en ${f.source}.`,
      );
      continue;
    }
    if (
      f.source === 'ITINERARIO' &&
      (previous || coverage.get(key(f.date, f.direction, carrier) + '|' + other) === OFFICIAL[carrier])
    )
      continue;
    flights.set(identity, {
      number: n,
      date: f.date,
      time: f.time,
      direction: f.direction,
      origin: f.origin,
      destination: f.destination,
      source: f.source,
    });
  }
  return { flights, coverage, days: [...dates].sort() };
}
function snapshot(row) {
  return Object.fromEntries(
    MUTABLE.map((k) => [k, k === 'scheduledAt' || k === 'lastCheckedAt' ? iso(row[k]) : (row[k] ?? null)]),
  );
}
function attached(row) {
  return Boolean(
    row._count?.reservations ||
    row._count?.assignments ||
    row.pickupStartOverrideAt ||
    row.pickupGroupId ||
    row.passengers ||
    row.notes?.trim(),
  );
}
function change(id, direction, before, after, kind) {
  return { id, direction, kind, before, after };
}
function onRoute(row) {
  // AirLabs historically stored the Buenos Aires airport as BOTH endpoints for departures.
  const opposite = airport(row.direction === 'ARRIVAL' ? row.origin : row.destination);
  const cpcEnd = airport(row.direction === 'ARRIVAL' ? row.destination : row.origin);
  return isBuenosAires(opposite) &&
    (cpcEnd === 'CPC' || (row.direction === 'DEPARTURE' && isBuenosAires(cpcEnd)))
    ? opposite
    : null;
}
function lastSource(row) {
  if (!WITHDRAWN.has(row.source)) return row.source;
  if (!row.externalId?.startsWith(withdrawnPrefix)) return null;
  return row.externalId.slice(withdrawnPrefix.length);
}
const operational = (row) => row.status === 'SCHEDULED' && !row.estimatedAt && !row.actualAt;
function withdraw(row) {
  const after = snapshot(row);
  after.source = attached(row) ? 'REVISAR' : 'RETIRADO';
  after.externalId = withdrawnPrefix + lastSource(row);
  return after;
}
export function planSchedules(payload, rows, now = new Date()) {
  const parsed = parsePayload(payload, localDate(now));
  const groups = new Map();
  const changes = [],
    warnings = [];
  for (const row of rows) {
    const n = canonical(row.number);
    if (!n || !parsed.days.includes(localDate(row.scheduledAt))) continue;
    const k = key(localDate(row.scheduledAt), row.direction, n);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  for (const [k, f] of parsed.flights) {
    const candidates = groups.get(k) ?? [];
    groups.delete(k);
    const row = candidates[0];
    if (candidates.length > 1 || (row && !onRoute(row))) {
      warnings.push({ key: k, reason: 'IDENTIDAD_AMBIGUA' });
      continue;
    }
    if (row && (!MANAGED.has(row.source) || !operational(row))) {
      warnings.push({ key: k, reason: 'FILA_OPERATIVA_O_MANUAL' });
      continue;
    }
    if (
      row &&
      f.source === 'ITINERARIO' &&
      (lastSource(row) === OFFICIAL[f.number.slice(0, 2)] || (WITHDRAWN.has(row.source) && !lastSource(row)))
    ) {
      warnings.push({ key: k, reason: 'PRIORIDAD_OFICIAL' });
      continue;
    }
    const before = row ? snapshot(row) : null;
    const after = {
      number: f.number,
      airline: f.number.slice(0, 2),
      origin: f.origin,
      destination: f.destination,
      source: f.source,
      scheduledAt: iso(`${f.date}T${f.time}:00-03:00`),
      externalId: `PROG@${f.date}@${f.number}@${f.direction}`,
      lastCheckedAt: before?.lastCheckedAt ?? null,
    };
    if (before && MUTABLE.every((field) => before[field] === after[field])) continue;
    after.lastCheckedAt = iso(now);
    changes.push(change(row?.id ?? randomUUID(), f.direction, before, after, row ? 'UPDATE' : 'CREATE'));
  }
  for (const [k, candidates] of groups) {
    for (const row of candidates) {
      const n = canonical(row.number),
        carrier = n.slice(0, 2);
      const a = onRoute(row);
      if (!a) continue;
      const source = parsed.coverage.get(key(localDate(row.scheduledAt), row.direction, carrier) + '|' + a);
      if (!source || !MANAGED.has(row.source) || !operational(row)) continue;
      if (candidates.length > 1) {
        warnings.push({ key: k, reason: 'IDENTIDAD_AMBIGUA' });
        break;
      }
      if (WITHDRAWN.has(row.source)) {
        if (row.source === 'RETIRADO' && attached(row))
          changes.push(
            change(row.id, row.direction, snapshot(row), { ...snapshot(row), source: 'REVISAR' }, 'REVIEW'),
          );
        continue;
      }
      if (source === 'ITINERARIO' && row.source !== 'ESTIMADO' && row.source !== 'ITINERARIO') continue;
      const after = withdraw(row);
      changes.push(
        change(
          row.id,
          row.direction,
          snapshot(row),
          after,
          after.source === 'REVISAR' ? 'REVIEW' : 'WITHDRAW',
        ),
      );
    }
  }
  return { changes, warnings };
}

async function withTransaction(prisma, apply, perform) {
  return prisma.$transaction(
    async (tx) => {
      if (apply) {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        // Stabilize both the flight inventory and linked work until the journal commits.
        await tx.$executeRaw`LOCK TABLE "Flight" IN SHARE ROW EXCLUSIVE MODE`;
        await tx.$executeRaw`LOCK TABLE "AirportReservationDetails", "AirportVehicleAssignment" IN SHARE MODE`;
      } else {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      }
      return perform(tx);
    },
    { isolationLevel: apply ? 'ReadCommitted' : 'RepeatableRead', timeout: 60000, maxWait: 10000 },
  );
}
async function finish(tx, { changes, warnings }, apply, rollbackOf = null) {
  const counts = { CREATE: 0, UPDATE: 0, WITHDRAW: 0, REVIEW: 0, RESTORE: 0 };
  for (const op of changes) counts[op.kind]++;
  const result = { runId: null, applied: false, counts, changes, warnings };
  if (!apply || !changes.length) return result;
  const updates = changes.filter((c) => c.before).map((c) => ({ id: c.id, ...c.after }));
  if (updates.length) {
    const affected = await tx.$executeRaw`
      UPDATE "Flight" f SET "number" = p."number", "airline" = p."airline", "source" = p."source",
        "origin" = p."origin", "destination" = p."destination", "externalId" = p."externalId",
        "scheduledAt" = p."scheduledAt" AT TIME ZONE 'UTC', "lastCheckedAt" = p."lastCheckedAt" AT TIME ZONE 'UTC',
        "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS p(id text,"number" text, "airline" text, "source" text,
          "origin" text, "destination" text,"externalId" text, "scheduledAt" timestamptz, "lastCheckedAt" timestamptz)
      WHERE f.id = p.id`;
    requireValue(affected === updates.length, 'El conjunto de vuelos cambió durante la conciliación.');
  }
  const creates = changes
    .filter((c) => !c.before)
    .map((c) => ({ id: c.id, direction: c.direction, ...c.after }));
  if (creates.length) await tx.flight.createMany({ data: creates });
  const runId = randomUUID();
  await tx.auditLog.create({
    data: {
      id: runId,
      action: 'UPDATE',
      entity: auditEntity,
      entityId: runId,
      entityLabel: 'Programación de vuelos',
      summary: `${rollbackOf ? 'Reversión' : 'Conciliación'} de horarios: ${changes.length} vuelos.`,
      changes: { version: 1, rollbackOf, flights: changes },
    },
  });
  return { ...result, runId, applied: true };
}

/** Preview by default. Positive observations can stand alone; coverage attests a complete scope. */
export async function applySchedules(prisma, payload, { apply = false, now = new Date() } = {}) {
  requireValue(typeof apply === 'boolean', 'apply debe ser booleano.');
  const { days } = parsePayload(payload, localDate(now));
  return withTransaction(prisma, apply, async (tx) => {
    const rows = days.length
      ? await tx.flight.findMany({
          select,
          where: {
            scheduledAt: {
              gte: new Date(`${days[0]}T00:00:00-03:00`),
              lt: new Date(Date.parse(`${days.at(-1)}T00:00:00-03:00`) + 86400000),
            },
          },
        })
      : [];
    return finish(tx, planSchedules(payload, rows, now), apply);
  });
}

/** Reverse only unchanged future flights; newly-created rows are tombstoned to retain their IDs. */
export async function rollbackSchedules(prisma, runId, { apply = false, now = new Date() } = {}) {
  requireValue(typeof apply === 'boolean', 'apply debe ser booleano.');
  return withTransaction(prisma, apply, async (tx) => {
    const log = await tx.auditLog.findUnique({
      where: { id: runId },
      select: { entity: true, changes: true },
    });
    requireValue(
      log?.entity === auditEntity && log.changes?.version === 1 && Array.isArray(log.changes?.flights),
      'No se encontró una conciliación compatible.',
    );
    const original = log.changes.flights;
    const rows = await tx.flight.findMany({ select, where: { id: { in: original.map((c) => c.id) } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const changes = [],
      warnings = [];
    for (const c of original) {
      const row = byId.get(c.id);
      const before = row && snapshot(row);
      if (
        !row ||
        localDate(row.scheduledAt) <= localDate(now) ||
        !operational(row) ||
        row.direction !== c.direction ||
        MUTABLE.some((k) => before[k] !== c.after[k])
      ) {
        warnings.push({ id: c.id, reason: 'CAMBIO_POSTERIOR_O_FECHA_PASADA' });
        continue;
      }
      let after = c.before ?? withdraw(row);
      if (after.source === 'RETIRADO' && attached(row)) after = { ...after, source: 'REVISAR' };
      changes.push(change(c.id, row.direction, before, after, 'RESTORE'));
    }
    return finish(tx, { changes, warnings }, apply, runId);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const positional = args.filter((a) => a !== '--apply');
  const rollback = positional[0] === '--rollback';
  requireValue(
    positional.length === (rollback ? 2 : 1) && !positional.at(-1).startsWith('--'),
    'Uso: node scripts/airport/apply-schedules.mjs archivo.json [--apply] | --rollback ID [--apply]',
  );
  requireValue(process.env.DATABASE_URL, 'Falta DATABASE_URL.');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const result = rollback
      ? await rollbackSchedules(prisma, positional[1], { apply })
      : await applySchedules(prisma, JSON.parse(await readFile(positional[0], 'utf8')), { apply });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
