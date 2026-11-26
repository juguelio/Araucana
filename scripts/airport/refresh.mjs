import { appendFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { collectAerolineas } from './ar-schedules.mjs';
import { collectJetSmart } from './ja-schedules.mjs';

const endpoint = 'https://araucana.vercel.app/api/internal/airport-schedules';
const localDay = time => new Date(time - 3 * 3600000).toISOString().slice(0, 10);
const now = Date.now();
const days = Array.from({ length: 35 }, (_, index) => localDay(now + (index + 1) * 86400000));
const batch = { asOf: localDay(now), flights: [], coverage: [] };
const browser = await chromium.launch();
const summary = [
  '## Cobertura de la programación de vuelos', '',
  'Cada consulta corresponde a una fecha y un sentido entre Chapelco y Buenos Aires (Aeroparque y Ezeiza).', '',
  '| Aerolínea | Período | Vuelos publicados | Consultas completas | Sólo con vuelos observados | Sin datos |',
  '| --- | --- | ---: | ---: | ---: | ---: |'
];
const alerts = [];
const directions = ['ARRIVAL', 'DEPARTURE'];
const scopeKey = row => row.date + '|' + row.direction;

function reportPeriod(carrier, dates, flights, coverage, requireOfficial) {
  const within = row => dates.includes(row.date);
  const observed = new Set(flights.filter(within).map(scopeKey));
  const countFlights = new Set(flights.filter(within).map(f => scopeKey(f) + '|' + f.number)).size;
  const complete = new Set(coverage.filter(within).map(scopeKey));
  const official = new Set(coverage.filter(c => c.source === carrier + '_OFICIAL').map(scopeKey));
  let onlyObserved = 0;
  const missing = [], missingOfficial = [];
  for (const date of dates) {
    for (const direction of directions) {
      const key = scopeKey({ date, direction });
      const label = date + (direction === 'ARRIVAL' ? ' arribos' : ' partidas');
      if (requireOfficial && !official.has(key)) missingOfficial.push(label);
      if (complete.has(key)) continue;
      if (observed.has(key)) onlyObserved++;
      else missing.push(label);
    }
  }
  const period = dates[0] + ' a ' + dates.at(-1);
  summary.push(`| ${carrier} | ${period} | ${countFlights} | ${complete.size} / ${dates.length * 2} | ${onlyObserved} | ${missing.length} |`);
  console.log(`${carrier} ${period}: ${countFlights} vuelos, ${complete.size} consultas completas, ${onlyObserved} sólo con publicaciones, ${missing.length} sin datos.`);
  if (missingOfficial.length) alerts.push(`${carrier} · consulta oficial incompleta en ${missingOfficial.join(', ')}.`);
  if (missing.length && !requireOfficial) alerts.push(`${carrier} · sin cobertura ni vuelos publicados en ${missing.join(', ')}.`);
}

try {
  const results = await Promise.allSettled([
    collectAerolineas(browser, days),
    collectJetSmart(browser, days)
  ]);
  for (const [index, result] of results.entries()) {
    const carrier = index === 0 ? 'AR' : 'JA';
    if (result.status === 'rejected') console.error('Falló la consulta de', carrier, String(result.reason));
    const { flights, coverage, warnings = [] } = result.status === 'fulfilled' ? result.value : { flights: [], coverage: [] };
    for (const warning of warnings.slice(0, 10)) console.warn(carrier, JSON.stringify(warning));
    // Only a complete reading from the collector can withdraw a flight; booking offers are positive evidence.
    const scopes = coverage.filter(c => c.carrier === carrier && days.includes(c.date) && directions.includes(c.direction) &&
      c.airports?.includes('AEP') && c.airports.includes('EZE')).map(c => ({ ...c, source: c.source ?? (carrier === 'AR' ? 'AR_OFICIAL' : 'ITINERARIO') }));
    batch.flights.push(...flights);
    batch.coverage.push(...scopes);
    if (carrier === 'AR') reportPeriod(carrier, days, flights, scopes, true);
    else {
      reportPeriod(carrier, days.slice(0, 7), flights, scopes, true);
      reportPeriod(carrier, days.slice(7), flights, scopes, false);
    }
  }
} finally {
  await browser.close();
}
if (alerts.length) {
  summary.push('', '### Consultas pendientes', '', ...alerts.map(message => '- ' + message));
  for (const message of alerts) console.warn(message);
}
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
if (!batch.flights.length) throw new Error('Ninguna fuente devolvió programación fechada.');
const tokenUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
tokenUrl.searchParams.set('audience', endpoint);
const tokenResponse = await fetch(tokenUrl, {
  headers: { Authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
  signal: AbortSignal.timeout(15000)
});
if (!tokenResponse.ok) throw new Error('GitHub no emitió la credencial del workflow.');
const { value: token } = await tokenResponse.json();
const response = await fetch(endpoint, {
  method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify(batch), signal: AbortSignal.timeout(125000), redirect: 'error'
});
if (!response.ok) throw new Error('Error al conciliar la programación: HTTP ' + response.status);
const result = await response.json();
console.log('Resultado de la conciliación:', JSON.stringify(result));
if (alerts.length || result.warnings?.length) {
  throw new Error('Conciliación parcial. Revisá la cobertura y los avisos registrados.');
}
