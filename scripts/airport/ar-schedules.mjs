const timetable = "https://www.aerolineas.com.ar/scheduled-flights";
const buenosAiresAirports = ["AEP", "EZE"];
const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function checkDays(days) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires"
  }).format(new Date());
  const horizon = new Date(today + "T00:00:00Z");
  horizon.setUTCDate(horizon.getUTCDate() + 35);
  const lastDay = horizon.toISOString().slice(0, 10);
  if (!Array.isArray(days) || days.length > 35) {
    throw new RangeError("Se esperan hasta 35 fechas de Chapelco");
  }
  for (const day of days) {
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day <= today ||
        day > lastDay || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) {
      throw new RangeError("Fecha fuera de la ventana futura de Chapelco: " + day);
    }
  }
  return [...new Set(days)].sort();
}

async function selectAirport(page, placeholder, code) {
  const input = page.getByPlaceholder(placeholder);
  await input.fill(code);
  await page.getByRole("option", { name: new RegExp("\\(" + code + "\\)$") }).click();
  if (!(await input.inputValue()).endsWith("(" + code + ")")) {
    throw new Error("La ruta seleccionada difiere de la solicitada");
  }
}

// La grilla marca cada vuelo en las columnas de los días en que opera.
// Leer la tabla en una sola operación evita mezclar marcas y filas de dos renders.
function readTimetable(table) {
  const headers = Array.from(table.querySelectorAll(".sfs-day-title"), el => el.innerText.trim());
  const rows = Array.from(table.querySelectorAll(".sfs-itinerary-box"), box => {
    const get = selector => box.querySelector(selector)?.innerText.trim();
    const marks = [];
    for (let el = box.nextElementSibling; el?.matches(".sfs-day"); el = el.nextElementSibling) {
      marks.push(Boolean(el.querySelector(".sfs-checked-icon")));
    }
    return {
      number: get(".sfs-airline-code"),
      stops: get(".sfs-itinerary-stops"),
      origin: get(".sfs-itinerary-from-box .sfs-itinerary-airport"),
      departure: get(".sfs-itinerary-from-box .sfs-itinerary-hour"),
      destination: get(".sfs-itinerary-to-box .sfs-itinerary-airport"),
      arrival: get(".sfs-itinerary-to-box .sfs-itinerary-hour"),
      marks
    };
  });
  return { headers, rows };
}

async function readDay(page, date, direction) {
  const arrival = direction === "ARRIVAL";
  // Cargar un formulario nuevo impide atribuir el resultado anterior a una fecha fallida.
  await page.goto(timetable, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByPlaceholder("Ingresá el origen").waitFor();
  const cookies = page.getByRole("button", { name: "Aceptar solo las esenciales" });
  if (await cookies.isVisible()) await cookies.click();
  await selectAirport(page, "Ingresá el origen", arrival ? "BUE" : "CPC");
  await selectAirport(page, "Ingresá el destino", arrival ? "CPC" : "BUE");
  const dateField = page.getByPlaceholder("DD/MM/AAAA");
  const localDate = date.split("-").reverse().join("/");
  await dateField.fill(localDate);
  await dateField.press("Tab");
  await page.getByRole("button", { name: "Consultar" }).click();
  await page.locator(".sfs-itinerary-box").first().waitFor({ timeout: 15_000 });
  const { headers, rows } = await page.locator(".sfs-grid-box").evaluate(readTimetable);
  const expected = new Date(date + "T00:00:00Z");
  expected.setUTCDate(expected.getUTCDate() - 3);
  const completeWeek = headers.length === 7 && headers.every(header => {
    const matches = /\b(\d{1,2})$/.exec(header);
    const correct = matches && Number(matches[1]) === expected.getUTCDate();
    expected.setUTCDate(expected.getUTCDate() + 1);
    return correct;
  });
  if (await dateField.inputValue() !== localDate || !completeWeek || !rows.length) {
    throw new Error("La fecha publicada no se pudo verificar");
  }
  const flights = new Map();
  for (const row of rows) {
    if (row.marks.length !== 7 || !row.stops) throw new Error("Fila de calendario incompleta");
    if (!row.marks[3]) continue;
    if (/^\d+ escalas?$/i.test(row.stops)) continue;
    const correctRoute = arrival
      ? row.destination === "CPC" && buenosAiresAirports.includes(row.origin)
      : row.origin === "CPC" && buenosAiresAirports.includes(row.destination);
    if (row.stops !== "Sin escalas" || !correctRoute || !/^AR\d{3,4}$/.test(row.number) ||
        !validTime.test(row.departure) || !validTime.test(row.arrival) || row.arrival <= row.departure) {
      throw new Error("Vuelo directo, ruta u horario sin validar");
    }
    const flight = {
      date, number: row.number, direction, origin: row.origin, destination: row.destination,
      time: arrival ? row.arrival : row.departure, source: "AR_OFICIAL"
    };
    const previous = flights.get(row.number);
    if (previous && (previous.time !== flight.time || previous.origin !== flight.origin ||
        previous.destination !== flight.destination)) {
      throw new Error("El calendario publicó dos variantes del mismo vuelo");
    }
    flights.set(row.number, flight);
  }
  if (!flights.size) throw new Error("El calendario no confirmó vuelos directos para la fecha");
  return [...flights.values()];
}

export async function collectAerolineas(browser, days) {
  const dates = checkDays(days);
  const flights = [];
  const coverage = [];
  if (!dates.length) return { flights, coverage };
  const context = await browser.newContext({ locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  context.setDefaultTimeout(12_000);
  try {
    await Promise.all(["ARRIVAL", "DEPARTURE"].map(async direction => {
      const page = await context.newPage();
      for (const date of dates) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const confirmed = await readDay(page, date, direction);
            flights.push(...confirmed);
            coverage.push({ date, direction, carrier: "AR", airports: [...buenosAiresAirports] });
            break;
          } catch (error) {
            // El segundo intento empieza con un formulario vacío y las mismas validaciones.
            if (attempt === 1 && (error.name === "TimeoutError" || /net::ERR_/.test(error.message))) continue;
            console.warn("AR_OFICIAL", date, direction, String(error.message).split("\n")[0]);
            break;
          }
        }
      }
    }));
  } finally {
    await context.close();
  }
  const order = (a, b) => a.date.localeCompare(b.date) || a.direction.localeCompare(b.direction);
  flights.sort((a, b) => order(a, b) || a.time.localeCompare(b.time));
  coverage.sort(order);
  return { flights, coverage };
}
