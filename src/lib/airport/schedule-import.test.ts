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
