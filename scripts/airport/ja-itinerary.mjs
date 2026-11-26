const base = 'https://www.flightinformation.com';
const airports = ['AEP', 'EZE'];
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Each month belongs to the route selected on the public calendar. Its day keys are local. */
export function readRouteMonth(payload, month, origin, destination, dates) {
  if (
    payload?.ef !== 1 ||
    !payload.days ||
    typeof payload.days !== 'object' ||
    Array.isArray(payload.days) ||
    !Object.keys(payload.days).length
  ) {
    throw new Error('El calendario no publicó un mes verificable');
  }
  const result = [];
  const direction = destination === 'CPC' ? 'ARRIVAL' : 'DEPARTURE';
  for (const [day, flights] of Object.entries(payload.days)) {
    if (!/^\d{1,2}$/.test(day) || !Array.isArray(flights)) throw new Error('Día de itinerario inválido');
    const date = month + '-' + day.padStart(2, '0');
    if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new Error('Fecha de itinerario inválida');
    }
    for (const row of flights) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0])
        throw new Error('Falta la aerolínea operadora');
      const [carrier, dep, arr, number] = row;
      if (!['JA', 'WJ'].includes(carrier)) continue;
      const id = /^(?:WJ|JA)(\d{1,4})$/.exec(number);
      if (!id || !clock.test(dep) || !clock.test(arr) || arr <= dep)
        throw new Error('Horario o número ilegible en el calendario');
      if (dates.includes(date))
        result.push({
          date,
          number: 'JA' + id[1],
          direction,
          origin,
          destination,
          time: direction === 'ARRIVAL' ? arr : dep,
          source: 'ITINERARIO',
          url: `${base}/${origin}-${destination}`,
        });
    }
  }
  return result;
}

async function collectRoute(context, origin, destination, dates) {
  const page = await context.newPage();
  const url = `${base}/${origin}-${destination}`;
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))].sort();
  const responses = new Map();
  // Only observe the month requests made by the published page, using its ordinary browser session.
  page.on('response', (response) => {
    const u = new URL(response.url());
    if (
      u.origin === 'https://apis.flightinformation.com' &&
      /^\/map\/c\d+-\d+\/\d\d-\d{1,2}\.json$/.test(u.pathname)
    )
      responses.set(u.pathname, response);
  });
  const flights = [],
    covered = new Set(),
    warnings = [];
  try {
    const main = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (!main?.ok()) throw new Error('El calendario público respondió HTTP ' + main?.status());
    const cfg = await page
      .locator('template#route-page-config')
      .evaluate((template) => JSON.parse(template.content.textContent).routePage, undefined, {
        timeout: 6000,
      });
    const cal = cfg?.calendar;
    if (
      cfg?.from !== origin ||
      cfg?.to !== destination ||
      !cal?.enabled ||
      !Number.isInteger(cal.fromAirportId) ||
      !Number.isInteger(cal.toAirportId)
    )
      throw new Error('Ruta inesperada en el calendario');
    await page.locator('[data-route-calendar-day]').first().waitFor({ state: 'attached', timeout: 8000 });
    let displayed = `${cal.year}-${String(cal.month).padStart(2, '0')}`;
    for (const month of months) {
      try {
        const requested = dates.filter(
          (date) => date.startsWith(month) && date >= cal.minDate && date <= cal.maxDate,
        );
        if (!requested.length) continue;
        const [year, m] = month.split('-');
        const path = `/map/c${cal.fromAirportId}-${cal.toAirportId}/${year.slice(2)}-${Number(m)}.json`;
        // The visible month and its adjacent month normally load together. Navigate further on month boundaries.
        while (displayed < month && !responses.has(path)) {
          await page.getByRole('button', { name: 'Next month' }).click({ timeout: 6000 });
          const d = new Date(displayed + '-15T12:00:00Z');
          d.setUTCMonth(d.getUTCMonth() + 1);
          displayed = d.toISOString().slice(0, 7);
          await page
            .locator(`[data-route-calendar-date="${displayed}-01"][data-route-calendar-in-month="1"]`)
            .waitFor({ state: 'attached', timeout: 6000 });
        }
        const response =
          responses.get(path) ??
          (await page.waitForResponse(
            (r) =>
              new URL(r.url()).origin === 'https://apis.flightinformation.com' &&
              new URL(r.url()).pathname === path,
            { timeout: 12000 },
          ));
        if (!response.ok()) throw new Error('El calendario mensual respondió HTTP ' + response.status());
        flights.push(...readRouteMonth(await response.json(), month, origin, destination, requested));
        requested.forEach((date) => covered.add(date));
      } catch (error) {
        warnings.push({
          source: 'ITINERARIO',
          origin,
          destination,
          month,
          error: error.message.split('\n')[0],
        });
      }
    }
  } catch (error) {
    warnings.push({ source: 'ITINERARIO', origin, destination, error: error.message.split('\n')[0] });
  } finally {
    await page.close();
  }
  return { flights, covered, warnings };
}

export async function fetchJetSmartItinerary(days, { browser }) {
  const dates = [...new Set(days)].sort();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(
    new Date(),
  );
  const limit = new Date(Date.parse(today) + 35 * 86400000).toISOString().slice(0, 10);
  if (
    dates.length > 35 ||
    dates.some(
      (date) =>
        !/^\d{4}-\d\d-\d\d$/.test(date) ||
        date <= today ||
        date > limit ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date,
    )
  )
    throw new Error('Fechas fuera del horizonte del calendario');
  const flights = [],
    coverage = [],
    warnings = [];
  if (!dates.length) return { flights, coverage, warnings };
  const context = await browser.newContext();
  try {
    await Promise.all(
      ['ARRIVAL', 'DEPARTURE'].map(async (direction) => {
        const routes = [];
        for (const airport of airports) {
          routes.push(
            await collectRoute(
              context,
              direction === 'ARRIVAL' ? airport : 'CPC',
              direction === 'ARRIVAL' ? 'CPC' : airport,
              dates,
            ),
          );
        }
        warnings.push(...routes.flatMap((r) => r.warnings));
        const byDate = new Map();
        for (const f of routes.flatMap((r) => r.flights)) {
          if (!byDate.has(f.date)) byDate.set(f.date, []);
          byDate.get(f.date).push(f);
        }
        for (const date of dates) {
          const dated = byDate.get(date) ?? [];
          const unique = new Map(dated.map((f) => [f.number, f]));
          if (
            dated.some((f) => {
              const other = unique.get(f.number);
              return (
                other.time !== f.time || other.origin !== f.origin || other.destination !== f.destination
              );
            })
          ) {
            warnings.push({
              source: 'ITINERARIO',
              date,
              direction,
              error: 'El calendario asignó horarios o rutas distintos al mismo vuelo',
            });
            continue;
          }
          flights.push(...unique.values());
          if (routes.every((r) => r.covered.has(date)))
            coverage.push({ date, direction, carrier: 'JA', airports: [...airports], source: 'ITINERARIO' });
        }
      }),
    );
  } finally {
    await context.close();
  }
  return { flights, coverage, warnings };
}
