import { describe, expect, it } from 'vitest';
import { planSchedules } from '../../../scripts/airport/apply-schedules.mjs';

const now = new Date('2027-01-10T12:00:00Z');
const date = '2027-01-12';
const coverage = [
  { date, carrier: 'JA', direction: 'DEPARTURE', airports: ['AEP', 'EZE'], source: 'ITINERARIO' },
];
const flight = {
  date,
  number: 'JA3182',
  direction: 'DEPARTURE',
  origin: 'CPC',
  destination: 'EZE',
  time: '14:58',
  source: 'JA_OFICIAL',
};
const row = {
  id: 'stable',
  number: 'JA3182',
  airline: 'JA',
  direction: 'DEPARTURE',
  origin: 'AEP',
  destination: 'AEROPARQUE',
  source: 'ESTIMADO',
  status: 'SCHEDULED',
  externalId: null,
  scheduledAt: new Date(date + 'T11:40:00-03:00'),
  estimatedAt: null,
  actualAt: null,
  pickupGroupId: null,
  passengers: null,
  lastCheckedAt: null,
  pickupStartInitialAt: null,
  pickupStartOverrideAt: null,
  _count: { reservations: 0, assignments: 0 },
};
const calendar = { ...flight, source: 'ITINERARIO', url: 'https://www.flightinformation.com/CPC-EZE' };
const offer = { ...calendar, url: 'https://interturis.almundo.com.ar/flights/results', time: '15:35' };
function stored(change: ReturnType<typeof planSchedules>['changes'][number]) {
  return {
    ...row,
    ...change.after,
    id: change.id,
    scheduledAt: new Date(change.after.scheduledAt),
    lastCheckedAt: change.after.lastCheckedAt ? new Date(change.after.lastCheckedAt) : null,
  };
}

describe('Conciliación del calendario futuro', () => {
  it('corrige una proyección en el mismo ID respetando referencias y controles de la operación', () => {
    const active = { ...row, _count: { reservations: 4, assignments: 1 }, pickupStartOverrideAt: now };
    const out = planSchedules({ flights: [flight], coverage }, [active], now);
    expect(out.changes[0]).toMatchObject({
      id: 'stable',
      kind: 'UPDATE',
      after: {
        origin: 'CPC',
        destination: 'EZE',
        source: 'JA_OFICIAL',
        scheduledAt: '2027-01-12T17:58:00.000Z',
      },
    });
    expect(out.changes[0].after).not.toHaveProperty('pickupStartOverrideAt');
  });
  it('un itinerario secundario no altera programación oficial, otro aeropuerto ni tramos sin cobertura', () => {
    const others = [
      { ...row, source: 'JA_OFICIAL' },
      { ...row, id: '2', number: 'JA3184', direction: 'ARRIVAL', origin: 'EZE', destination: 'CPC' },
      { ...row, id: '3', number: 'JA3186', origin: 'CPC', destination: 'COR' },
    ];
    expect(planSchedules({ flights: [], coverage }, others, now).changes).toEqual([]);
    expect(
      planSchedules({ flights: [{ ...flight, source: 'ITINERARIO' }], coverage }, [others[0]], now).changes,
    ).toEqual([]);
  });
  it('retira proyecciones sin borrar filas y deja visibles las que tienen actividad', () => {
    const withWork = { ...row, id: '2', number: 'JA3184', _count: { reservations: 0, assignments: 1 } };
    const out = planSchedules({ flights: [], coverage }, [row, withWork], now);
    expect(out.changes.map((c) => c.after.source)).toEqual(['RETIRADO', 'REVISAR']);
    expect(planSchedules({ flights: [], coverage: [] }, [row, withWork], now).changes).toEqual([]);
  });
  it('permite restaurar un vuelo retirado sólo con evidencia de prioridad suficiente', () => {
    const gone = { ...row, source: 'RETIRADO', externalId: 'HORARIO_RETIRADO@JA_OFICIAL' };
    expect(
      planSchedules({ flights: [{ ...flight, source: 'ITINERARIO' }], coverage }, [gone], now).changes,
    ).toEqual([]);
    expect(planSchedules({ flights: [flight], coverage }, [gone], now).changes[0]).toMatchObject({
      id: gone.id,
      after: { source: 'JA_OFICIAL' },
    });
  });
  it('crea y actualiza ofertas hasta que se publica la grilla, que conserva el ID y el horario', () => {
    const offerOnly = { flights: [offer], coverage: [] };
    const created = planSchedules(offerOnly, [], now).changes[0];
    expect(created).toMatchObject({
      kind: 'CREATE',
      after: { source: 'ITINERARIO', externalId: expect.stringMatching(/^OFERTA@/) },
    });
    expect(planSchedules(offerOnly, [stored(created)], now).changes).toEqual([]);
    const corrected = planSchedules(
      { flights: [{ ...offer, time: '14:58' }], coverage: [] },
      [stored(created)],
      now,
    ).changes[0];
    expect(corrected).toMatchObject({
      kind: 'UPDATE',
      id: created.id,
      after: { scheduledAt: '2027-01-12T17:58:00.000Z', externalId: created.after.externalId },
    });
    const full = { flights: [{ ...flight, source: 'ITINERARIO' }], coverage };
    const published = planSchedules(full, [stored(corrected)], now).changes[0];
    expect(published).toMatchObject({
      kind: 'UPDATE',
      id: created.id,
      after: {
        source: 'ITINERARIO',
        scheduledAt: corrected.after.scheduledAt,
        externalId: expect.stringMatching(/^PROG@/),
      },
    });
    for (const payload of [full, offerOnly]) {
      expect(planSchedules(payload, [stored(published)], now)).toEqual({ changes: [], warnings: [] });
    }
  });
  it('resuelve horarios contradictorios entre la grilla y la oferta aunque la cobertura sea parcial', () => {
    for (const scopes of [[], coverage]) {
      for (const flights of [
        [offer, calendar],
        [calendar, offer],
      ]) {
        const changes = planSchedules({ flights, coverage: scopes }, [], now).changes;
        expect(changes).toHaveLength(1);
        expect(changes[0].after).toMatchObject({
          externalId: expect.stringMatching(/^PROG@/),
          scheduledAt: '2027-01-12T17:58:00.000Z',
        });
      }
    }
  });
  it('retira un vuelo que desapareció de la grilla, aunque todavía tenga una oferta', () => {
    const original = planSchedules({ flights: [offer], coverage: [] }, [row], now).changes[0];
    const absent = { flights: [offer], coverage };
    const withdrawal = planSchedules(absent, [stored(original)], now).changes[0];
    expect(withdrawal).toMatchObject({
      id: row.id,
      kind: 'WITHDRAW',
      after: { source: 'RETIRADO', externalId: 'HORARIO_RETIRADO@ITINERARIO' },
    });
    const gone = stored(withdrawal);
    for (const payload of [absent, { flights: [offer], coverage: [] }]) {
      expect(planSchedules(payload, [gone], now).changes).toEqual([]);
    }
    const restored = planSchedules({ flights: [calendar], coverage }, [gone], now).changes[0];
    expect(restored).toMatchObject({ id: row.id, kind: 'UPDATE', after: { source: 'ITINERARIO' } });
    expect(planSchedules({ flights: [], coverage }, [stored(restored)], now).changes[0].kind).toBe(
      'WITHDRAW',
    );
  });
  it.each(['RETIRADO', 'REVISAR'])(
    'registra el refuerzo de evidencia de %s como una sola actualización',
    (source) => {
      const gone = { ...row, source, externalId: 'HORARIO_RETIRADO@ITINERARIO' };
      const officialAbsence = { flights: [], coverage: [{ ...coverage[0], source: 'JA_OFICIAL' }] };
      const upgraded = planSchedules(officialAbsence, [gone], now).changes[0];
      expect(upgraded).toMatchObject({
        id: row.id,
        kind: 'UPDATE',
        after: { source, externalId: 'HORARIO_RETIRADO@JA_OFICIAL' },
      });
      for (const payload of [
        officialAbsence,
        { flights: [calendar], coverage },
        { flights: [offer], coverage: [] },
      ]) {
        expect(planSchedules(payload, [stored(upgraded)], now).changes).toEqual([]);
      }
    },
  );
  it('rechaza rutas incoherentes y versiones contradictorias antes de escribir', () => {
    expect(() =>
      planSchedules({ flights: [flight, { ...flight, time: '15:10' }], coverage }, [], now),
    ).toThrow(/contradictorios/);
    expect(() => planSchedules({ flights: [{ ...flight, origin: 'AEP' }], coverage }, [], now)).toThrow(
      /tramo/,
    );
  });
  it('se abstiene si hay dos filas para el mismo vuelo, y omite el día en curso', () => {
    const ambiguous = planSchedules(
      { flights: [flight], coverage },
      [row, { ...row, id: '2', number: 'WJ3182' }],
      now,
    );
    expect(ambiguous.changes).toEqual([]);
    expect(ambiguous.warnings[0].reason).toBe('IDENTIDAD_AMBIGUA');
    expect(
      planSchedules({ flights: [flight], coverage }, [row], new Date(date + 'T12:00:00-03:00')).changes,
    ).toEqual([]);
  });
});
