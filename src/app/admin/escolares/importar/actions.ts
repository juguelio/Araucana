"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import ExcelJS from "exceljs";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { normalizarTipoDeConcesion, type SchoolRunKind } from "@/lib/school-runs/kinds";
import { clavesDeServicio, clavesDeServicioGuardado, normalizarNombre } from "@/lib/school-runs/import-key";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 3000;

type Entrada = {
  sheet: string;
  row: number;
  serviceDate: Date;
  routeName: string;
  shift: string;
  kind: SchoolRunKind;
  driver1: string;
  driver2: string;
  vehicle: string;
  status: string;
};

function texto(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object" && "result" in value) return texto((value as { result: unknown }).result);
  return String(value ?? "").trim();
}

function fecha(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const raw = texto(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`);
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!dmy) return null;
  const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
  return new Date(`${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}T00:00:00.000Z`);
}

function horario(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  }
  return texto(value) || "Sin horario";
}

function tipoDeFila(routeName: string): SchoolRunKind | null {
  if (/^(franco|feriado|licencia|vacaciones)\b/i.test(routeName)) return null;
  if (/\b(vuelo|jet\s*smart|aa\s+bue)\b/i.test(routeName)) return null;
  if (/personal|aeropuerto/i.test(routeName)) return "personal-aeropuerto";
  if (/escuela|primaria|secundari|colegio|cpem|quila|huemul|meliquina|payla|trompul|rampa|estimulaci/i.test(routeName)) return "escuela";
  return "otro";
}

function leerPlanilla(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  return workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]).then(() => {
    const entradas: Entrada[] = [];
    const omitidas = { vuelos: 0, novedades: 0 };
    workbook.eachSheet((sheet) => {
      // Las hojas de avisos («x ch …») repiten los mismos servicios: se usa sólo la hoja del día.
      if (!/^\d{6}$/.test(sheet.name)) return;
      const anio = `20${sheet.name.slice(-2)}`;
      const mes = sheet.name.slice(2, 4);
      const dia = sheet.name.slice(0, 2);
      const fechaHoja = new Date(`${anio}-${mes}-${dia}T00:00:00.000Z`);
      if (Number.isNaN(fechaHoja.getTime())) return;
      sheet.eachRow((row, number) => {
        if (number < 5) return;
        const routeName = texto(row.getCell(2).value).slice(0, 400);
        if (!routeName) return;
        const kind = tipoDeFila(routeName);
        if (!kind) {
          if (/\b(vuelo|jet\s*smart|aa\s*bue)\b/i.test(routeName)) omitidas.vuelos++;
          else omitidas.novedades++;
          return;
        }
        const fechaFila = fecha(row.getCell(1).value) ?? fechaHoja;
        entradas.push({
          sheet: sheet.name,
          row: number,
          serviceDate: fechaFila,
          routeName,
          shift: horario(row.getCell(3).value).slice(0, 100),
          kind,
          driver1: texto(row.getCell(4).value).slice(0, 200),
          driver2: texto(row.getCell(5).value).slice(0, 200),
          vehicle: texto(row.getCell(6).value).slice(0, 100),
          status: texto(row.getCell(7).value).slice(0, 200)
        });
      });
    });
    return { entradas: entradas.slice(0, MAX_ROWS), omitidas };
  });
}

export async function importarPlanilla(form: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const file = form.get("archivo");
  if (!(file instanceof File) || !file.size) {
    redirect("/admin/escolares/importar?aviso=" + encodeURIComponent("Elegí el archivo .xlsx de la planilla."));
  }
  if (file.size > MAX_BYTES) {
    redirect("/admin/escolares/importar?aviso=" + encodeURIComponent("El archivo supera los 8 MB."));
  }
  let parsed: Awaited<ReturnType<typeof leerPlanilla>>;
  try {
    parsed = await leerPlanilla(Buffer.from(await file.arrayBuffer()));
  } catch {
    redirect("/admin/escolares/importar?aviso=" + encodeURIComponent("No pude leer el Excel. Probá con el archivo original .xlsx."));
  }
  const { entradas, omitidas } = parsed;
  if (!entradas.length) {
    redirect("/admin/escolares/importar?aviso=" + encodeURIComponent("La planilla no tiene recorridos de Concesiones para importar."));
  }

  const [drivers, vehicles, existentes] = await Promise.all([
    prisma.user.findMany({ where: { role: "DRIVER", isActive: true }, select: { id: true, name: true, email: true } }),
    prisma.vehicle.findMany({ where: { isActive: true }, select: { id: true, name: true, internalNumber: true } }),
    prisma.schoolRun.findMany({
      where: { serviceDate: { gte: new Date(Math.min(...entradas.map((e) => +e.serviceDate))), lte: new Date(Math.max(...entradas.map((e) => +e.serviceDate))) } },
      select: { id: true, serviceDate: true, routeName: true, shift: true, driverId: true, vehicleId: true, companion: true, source: true }
    })
  ]);
  // Se acepta el nombre completo y el primer nombre («Juan» → «Juan Muñoz»), pero sólo si no es ambiguo.
  const candidatos = new Map<string, Set<string>>();
  for (const driver of drivers) {
    const nombre = normalizarNombre(driver.name ?? "");
    const claves = [nombre, nombre.split(" ")[0], normalizarNombre(driver.email.split("@")[0])].filter(Boolean);
    for (const clave of claves) {
      const ids = candidatos.get(clave) ?? new Set<string>();
      ids.add(driver.id);
      candidatos.set(clave, ids);
    }
  }
  const porNombre = new Map<string, string>();
  for (const [clave, ids] of candidatos) {
    if (ids.size === 1) porNombre.set(clave, [...ids][0]);
  }
  const nombrePorId = new Map(drivers.map((driver) => [driver.id, driver.name ?? ""] as const));
  // La columna F de la planilla es el número interno o el nombre de la nave, no un monto.
  const navesPorClave = new Map<string, Set<string>>();
  for (const vehicle of vehicles) {
    for (const clave of [vehicle.name, vehicle.internalNumber].filter(Boolean)) {
      const normalizada = normalizarNombre(clave!);
      if (!normalizada) continue;
      const ids = navesPorClave.get(normalizada) ?? new Set<string>();
      ids.add(vehicle.id);
      navesPorClave.set(normalizada, ids);
    }
  }
  const navePorNombre = new Map<string, string>();
  for (const [clave, ids] of navesPorClave) {
    if (ids.size === 1) navePorNombre.set(clave, [...ids][0]);
  }
  // Las filas viejas guardan `driver`/`companion` y el turno normalizado; las nuevas, `driver1`/`driver2`.
  // La clave tolera las dos formas para que reimportar la planilla no vuelva a crear lo que ya está (#407).
  const existentePorClave = new Map<string, { id: string; vehicleId: string | null }>();
  for (const run of existentes) {
    for (const clave of clavesDeServicioGuardado(run, {
      idPorNombre: (nombre) => porNombre.get(normalizarNombre(nombre)) ?? null,
      nombrePorId: (id) => nombrePorId.get(id) ?? null
    })) {
      if (!existentePorClave.has(clave)) existentePorClave.set(clave, { id: run.id, vehicleId: run.vehicleId });
    }
  }
  const vistas = new Set(existentePorClave.keys());
  const asignarNave: { id: string; vehicleId: string }[] = [];
  const nuevas = entradas.flatMap((entrada) => {
    const driverId = porNombre.get(normalizarNombre(entrada.driver1)) ?? null;
    const vehicleId = entrada.vehicle ? navePorNombre.get(normalizarNombre(entrada.vehicle)) ?? null : null;
    const claves = clavesDeServicio({
      serviceDate: entrada.serviceDate,
      routeName: entrada.routeName,
      shift: entrada.shift,
      chofer1: { id: driverId, nombre: entrada.driver1 },
      chofer2: { nombre: entrada.driver2 }
    });
    const claveExistente = claves.find((clave) => existentePorClave.has(clave));
    if (claveExistente) {
      const existente = existentePorClave.get(claveExistente)!;
      if (!existente.vehicleId && vehicleId) asignarNave.push({ id: existente.id, vehicleId });
      return [];
    }
    if (claves.some((clave) => vistas.has(clave))) return [];
    for (const clave of claves) vistas.add(clave);
    const revisar = [
      entrada.driver1 && !driverId ? `Chofer de planilla: ${entrada.driver1}` : "",
      entrada.driver2 ? `Segunda persona: ${entrada.driver2}` : "",
      entrada.vehicle && !vehicleId ? `Nave de planilla: ${entrada.vehicle}` : "",
      entrada.status
    ].filter(Boolean).join(" · ");
    return [{
      id: randomUUID(),
      serviceDate: entrada.serviceDate,
      kind: entrada.kind,
      routeName: entrada.routeName,
      shift: entrada.shift,
      driverId,
      vehicleId,
      companion: entrada.driver2 || null,
      notes: `Importado de ${entrada.sheet}, fila ${entrada.row}.`,
      review: revisar || null,
      source: { sheet: entrada.sheet, row: entrada.row, vehicle: entrada.vehicle, status: entrada.status, driver1: entrada.driver1, driver2: entrada.driver2 }
    }];
  });

  if (nuevas.length) {
    await prisma.schoolRun.createMany({ data: nuevas });
  }
  for (const { id, vehicleId } of asignarNave) {
    await prisma.schoolRun.updateMany({ where: { id, vehicleId: null }, data: { vehicleId } });
  }
  revalidatePath("/admin");
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath("/admin/escolares");
  revalidatePath("/admin/escolares/semana");
  const mensaje = `Importados ${nuevas.length} servicios de Concesiones.${asignarNave.length ? ` Asigné la nave en ${asignarNave.length} servicios ya cargados.` : ""} Omitidos ${omitidas.vuelos} vuelos y ${omitidas.novedades} francos/licencias. Los choferes o naves sin coincidencia quedaron para revisar.`;
  redirect("/admin/escolares/semana?aviso=" + encodeURIComponent(mensaje));
}
