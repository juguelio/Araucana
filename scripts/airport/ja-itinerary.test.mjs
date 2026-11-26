import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readRouteMonth } from './ja-itinerary.mjs';

test('lee vuelos individuales operados por JetSMART y conserva la hora local en Chapelco', () => {
  const month = {
    ef: 1,
    days: {
      28: [
        ['AR', '09:20', '11:45', 'AR1652'],
        ['JA', '10:05', '12:29', 'JA3183'],
      ],
      29: [['AR', '13:50', '16:15', 'AR1658']],
    },
  };
  assert.deepEqual(readRouteMonth(month, '2026-11', 'AEP', 'CPC', ['2026-11-28']), [
    {
      date: '2026-11-28',
      number: 'JA3183',
      direction: 'ARRIVAL',
      origin: 'AEP',
      destination: 'CPC',
      time: '12:29',
      source: 'ITINERARIO',
      url: 'https://www.flightinformation.com/AEP-CPC',
    },
  ]);
  assert.deepEqual(readRouteMonth(month, '2026-11', 'AEP', 'CPC', ['2026-11-29']), []);
  const dep = readRouteMonth(
    { ef: 1, days: { 1: [['JA', '10:52', '12:53', 'JA3182']] } },
    '2026-12',
    'CPC',
    'AEP',
    ['2026-12-01'],
  );
  assert.equal(dep[0].time, '10:52');
});

test('rechaza un mes omitido, una fecha imposible y una lectura JA truncada', () => {
  const read = (days) => readRouteMonth({ ef: 1, days }, '2026-11', 'AEP', 'CPC', ['2026-11-28']);
  assert.throws(() => read({}));
  assert.throws(() => read({ 31: [] }));
  assert.throws(() => read({ 28: [['JA', '12:00']] }));
});
