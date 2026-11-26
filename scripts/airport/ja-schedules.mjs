import { fetchJetSmartItinerary } from "./ja-itinerary.mjs";

const OFFICIAL = "https://jetsmart.com/ar/es/estado-de-vuelo/";
const ZONE = "America/Argentina/Buenos_Aires";
const DAY = 86_400_000;
const AIRPORTS = ["AEP", "EZE"];
const officialName = { AEP: "BUENOS AIRES, AEROPARQUE", EZE: "BUENOS AIRES, EZEIZA", CPC: "SAN MARTIN DE LOS ANDES" };
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function addDays(date, offset) {
  return new Date(Date.parse(date) + offset * DAY).toISOString().slice(0, 10);
}

function validateDays(days, today) {
  if (!Array.isArray(days) || days.length > 35) throw new Error("Se esperan hasta 35 fechas");
  for (const date of days) {
    if (typeof date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(date) ||
        date <= today || date > addDays(today, 35) || !Number.isFinite(Date.parse(date)) ||
        addDays(date, 0) !== date) throw new Error("Fecha futura inválida: " + date);
  }
  return [...new Set(days)].sort();
}

async function selectRoute(page, origin, destination) {
  for (const [index, code] of [origin, destination].entries()) {
    await page.getByRole("combobox").nth(index).fill(code);
    const option = page.locator('[id*="-option-"]').filter({ hasText: "(" + code + ")" });
    await option.last().click();
  }
}

// Cada tarjeta publica los dos aeropuertos, números comerciales y horas locales.
async function readOfficial(page, date, origin, destination) {
  const searchAgain = page.getByRole("button", { name: /Buscar el estado de otro vuelo/ });
  if (await searchAgain.isVisible()) {
    await searchAgain.click();
  } else {
    const response = await page.goto(OFFICIAL, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) throw new Error("HTTP " + (response?.status() ?? "sin respuesta"));
  }
  await selectRoute(page, origin, destination);
  const d = new Date(date + "T12:00:00Z");
  const formatted = d.toLocaleDateString("es-AR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: ZONE
  });
  const picker = page.locator('input[name="std"]');
  await picker.focus();
  await picker.press("ArrowDown");
  const choice = page.getByRole("option", { name: "Choose " + formatted, exact: true });
  if (!await choice.count()) {
    const next = page.getByRole("button", { name: "Next Month" });
    if (await next.isEnabled()) await next.click();
  }
  if (!await choice.count()) throw new Error("Fecha fuera del calendario oficial");
  await choice.click();
  const [y, m, dd] = date.split("-");
  if (await picker.inputValue() !== [dd, m, y].join("/")) throw new Error("Fecha de consulta inesperada");
  await page.getByRole("button", { name: "Ver estado de vuelo" }).click();
  await page.getByRole("heading", { name: formatted, exact: true }).waitFor();
  const result = page.locator("main");
  const routeName = officialName[origin] + " - " + officialName[destination];
  const routeHeading = result.getByRole("heading", { name: new RegExp("^" + routeName + "$", "i") });
  if (!await routeHeading.isVisible()) throw new Error("El resultado no identifica la ruta solicitada");
  const noResults = result.getByRole("heading", { name: /^No hemos encontrado resultados para el vuelo\/día ingresados\.$/i });
  if (await noResults.isVisible()) return [];
  const cards = await result.locator('[id="flight-num"]:visible').evaluateAll(nodes => nodes.map(node => {
    const card = node.closest(".row.align-items-center");
    const panel = node.closest(".card");
    const get = id => card?.querySelector('[id="' + id + '"]')?.textContent.trim();
    return {
      cancelled: /cancelado|cancelled/i.test(panel?.innerText ?? ""),
      number: node.innerText.trim(), origin: get("dep-text"), destination: get("arr-text"),
      departure: get("dep-date"), arrival: get("arr-date")
    };
  }));
  if (!cards.length) throw new Error("Respuesta oficial sin tarjetas legibles");
  const flights = [];
  for (const card of cards) {
    if (card.cancelled) continue;
    const number = card.number.match(/\bJA\s*(\d{2,4})\b/i);
    const time = destination === "CPC" ? card.arrival : card.departure;
    if (!number || !clock.test(card.departure) || !clock.test(card.arrival) || card.arrival <= card.departure || card.origin !== "(" + origin + ")" ||
        card.destination !== "(" + destination + ")") throw new Error("Tarjeta sin ruta y número verificables");
    flights.push({ date, number: "JA" + number[1], origin, destination, time,
      direction: destination === "CPC" ? "ARRIVAL" : "DEPARTURE", source: "JA_OFICIAL", url: OFFICIAL });
  }
  return flights;
}

// Una fecha y un sentido quedan cubiertos al verificar los resultados fechados de ambos aeropuertos.
async function collectOfficial(browser, dates) {
  const flights = [];
  const coverage = [];
  const warnings = [];
  if (!dates.length) return { flights, coverage, warnings };
  const context = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1500, height: 1200 } });
  context.setDefaultTimeout(15_000);
  try {
    await Promise.all(["ARRIVAL", "DEPARTURE"].map(async direction => {
      const page = await context.newPage();
      let blocked = false;
      for (const date of dates) {
        if (blocked) break;
        let routesRead = 0;
        const readings = [];
        for (const airport of AIRPORTS) {
          const origin = direction === "ARRIVAL" ? airport : "CPC";
          const destination = direction === "ARRIVAL" ? "CPC" : airport;
          try {
            readings.push(...await readOfficial(page, date, origin, destination));
            routesRead++;
          } catch (error) {
            const detail = error.message.split("\n")[0];
            warnings.push({ date, origin, destination, source: "JA_OFICIAL", error: detail });
            blocked = /^HTTP (?:401|403|406|429)/.test(detail);
            if (blocked) break;
          }
        }
        const unique = new Map(readings.map(flight => [flight.number, flight]));
        const conflict = readings.some(flight => {
          const other = unique.get(flight.number);
          return flight.origin !== other.origin || flight.destination !== other.destination || flight.time !== other.time;
        });
        if (conflict) {
          warnings.push({ date, direction, source: "JA_OFICIAL", error: "La aerolínea publicó dos variantes del mismo vuelo" });
          continue;
        }
        flights.push(...unique.values());
        if (routesRead === AIRPORTS.length) {
          coverage.push({ date, direction, carrier: "JA", airports: [...AIRPORTS], source: "JA_OFICIAL" });
        }
      }
    }));
  } finally {
    await context.close();
  }
  return { flights, coverage, warnings };
}

// Las ofertas disponibles solo aportan lecturas positivas. Un vuelo agotado puede seguir programado.
async function readOffers(page, date, direction) {
  const incoming = direction === "ARRIVAL";
  const url = new URL("https://interturis.almundo.com.ar/flights/results");
  url.search = new URLSearchParams({ adults: "1", currencyCode: "ARS", date,
    from: incoming ? "BUE" : "CPC", to: incoming ? "CPC" : "BUE" }).toString();
  const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error("HTTP " + (response?.status() ?? "sin respuesta"));
  const options = page.locator(".choice__detail");
  await options.first().waitFor();
  const offered = await options.evaluateAll(nodes => nodes.map((node, index) => ({
    index, direct: node.innerText.split(/\s+/).includes("Directo"),
    times: Array.from(node.querySelectorAll(".choice__detail__hour"), el => el.innerText.trim()),
    cities: Array.from(node.querySelectorAll(".choice__detail__city"), el => el.innerText.trim()),
    logo: node.querySelector(".choice__airlinesInfo img")?.getAttribute("src")
  })));
  const flights = new Map();
  const seen = new Set();
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const [year, month, day] = date.split("-");
  const datePattern = new RegExp("\\b0?" + Number(day) + " de " + months[Number(month)-1] + "(?:t)?\\.? " + year + "$", "i");
  for (const option of offered) {
    if (!option.direct || option.times.length !== 2 || !option.times.every(time => clock.test(time))) continue;
    const identity = JSON.stringify([option.logo, option.times, option.cities]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const choice = options.nth(option.index).locator(".choice__detail__hour").first();
    await choice.click();
    const legs = page.locator(".leg_detail:visible");
    await legs.first().waitFor();
    const details = await legs.evaluateAll(nodes => nodes.map(leg => ({
      operator: leg.querySelector(".leg_detail__airlineContainer__info")?.innerText ?? "",
      dates: Array.from(leg.querySelectorAll(".date"), el => el.innerText.trim()),
      hours: Array.from(leg.querySelectorAll(".hour"), el => el.innerText.trim())
    })));
    for (const detail of details) {
      if (!/operado por jetsmart/i.test(detail.operator) || detail.dates.length !== 2 ||
          !detail.dates.every(value => datePattern.test(value)) || detail.hours.length !== 2) continue;
      const number = detail.operator.match(/N[°º] vuelo:\s*(?:JA|WJ)\s*(\d{2,4})\b/i)?.[1];
      const departure = detail.hours[0].match(/^(\d\d:\d\d) ([A-Z]{3})$/);
      const arrival = detail.hours[1].match(/^(\d\d:\d\d) ([A-Z]{3})$/);
      if (!number || !departure || !arrival || departure[1] !== option.times[0] || arrival[1] !== option.times[1]) continue;
      const [, dep, origin] = departure;
      const [, arr, destination] = arrival;
      const valid = incoming ? destination === "CPC" && AIRPORTS.includes(origin) : origin === "CPC" && AIRPORTS.includes(destination);
      if (valid && arr > dep) {
        const flight = { date, number: "JA" + number, direction, origin, destination, time: incoming ? arr : dep,
          source: "ITINERARIO", url: url.href };
        const previous = flights.get(flight.number);
        if (previous && (previous.origin !== origin || previous.destination !== destination || previous.time !== flight.time)) {
          throw new Error("Dos ofertas contradictorias para el mismo vuelo");
        }
        flights.set(flight.number, flight);
      }
    }
    await choice.click();
  }
  return [...flights.values()];
}

async function collectPublishedOffers(browser, dates, itinerary) {
  const complete = new Set(itinerary.coverage.map(scope => scope.date + "|" + scope.direction));
  const existing = new Set(itinerary.flights.map(f => [f.date, f.number, f.direction].join("|")));
  const missing = dates.filter(date => !complete.has(date + "|ARRIVAL") || !complete.has(date + "|DEPARTURE"));
  if (!missing.length) return;
  const context = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1500, height: 1200 } });
  context.setDefaultTimeout(12_000);
  try {
    await Promise.all(["ARRIVAL", "DEPARTURE"].map(async direction => {
      const page = await context.newPage();
      for (const date of missing) {
        if (complete.has(date + "|" + direction)) continue;
        try {
          for (const flight of await readOffers(page, date, direction)) {
            if (!existing.has([date, flight.number, direction].join("|"))) itinerary.flights.push(flight);
          }
        } catch (error) {
          const detail = error.message.split("\n")[0];
          itinerary.warnings.push({ date, direction, source: "ITINERARIO", url: "https://interturis.almundo.com.ar", error: detail });
          if (/^HTTP (?:401|403|406|429)/.test(detail)) break;
        }
      }
    }));
  } finally {
    await context.close();
  }
}

async function collectLater(browser, dates) {
  if (!dates.length) return { flights: [], coverage: [], warnings: [] };
  const itinerary = await fetchJetSmartItinerary(dates, { browser }).catch(error => ({
    flights: [], coverage: [], warnings: [{source: "ITINERARIO", error: String(error)}]
  }));
  try {
    await collectPublishedOffers(browser, dates, itinerary);
  } catch (error) {
    itinerary.warnings.push({source: "ITINERARIO", error: String(error)});
  }
  return itinerary;
}

export async function collectJetSmart(browser, days) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE }).format(new Date());
  const dates = validateDays(days, today);
  const horizon = addDays(today, 7);
  const near = dates.filter(date => date <= horizon);
  const later = dates.filter(date => date > horizon);
  const results = await Promise.allSettled([
    collectOfficial(browser, near),
    collectLater(browser, later)
  ]);
  const flights = [];
  const coverage = [];
  const warnings = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      warnings.push({ source: index === 0 ? "JA_OFICIAL" : "ITINERARIO", error: String(result.reason) });
      continue;
    }
    flights.push(...result.value.flights);
    coverage.push(...result.value.coverage);
    warnings.push(...(result.value.warnings ?? []));
  }
  const order = (a, b) => a.date.localeCompare(b.date) || a.direction.localeCompare(b.direction);
  flights.sort((a, b) => order(a, b) || a.time.localeCompare(b.time));
  coverage.sort(order);
  return { flights, coverage, warnings };
}
