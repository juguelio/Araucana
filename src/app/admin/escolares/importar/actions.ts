"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import ExcelJS from "exceljs";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { normalizarTipoDeConcesion, type SchoolRunKind } from "@/lib/school-runs/kinds";

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

function normalizarNombre(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
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

  const [drivers, existentes] = await Promise.all([
    prisma.user.findMany({ where: { role: "DRIVER", isActive: true }, select: { id: true, name: true, email: true } }),
    prisma.schoolRun.findMany({
      where: { serviceDate: { gte: new Date(Math.min(...entradas.map((e) => +e.serviceDate))), lte: new Date(Math.max(...entradas.map((e) => +e.serviceDate))) } },
      select: { serviceDate: true, routeName: true, shift: true, driverId: true, source: true }
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
  const claveDe = (run: (typeof existentes)[number]) => {
    const source = run.source && typeof run.source === "object" && !Array.isArray(run.source) ? run.source as Record<string, unknown> : {};
    const raw1 = normalizarNombre(String(source.driver1 ?? ""));
    const raw2 = normalizarNombre(String(source.driver2 ?? ""));
    return `${run.serviceDate.toISOString().slice(0, 10)}|${run.routeName}|${run.shift}|${raw1 || run.driverId || ""}|${raw2}`;
  };
  const existentesPorClave = new Set(existentes.map(claveDe));
  const nuevas = entradas.flatMap((entrada) => {
    const driverId = porNombre.get(normalizarNombre(entrada.driver1)) ?? null;
    const clave = `${entrada.serviceDate.toISOString().slice(0, 10)}|${entrada.routeName}|${entrada.shift}|${normalizarNombre(entrada.driver1)}|${normalizarNombre(entrada.driver2)}`;
    if (existentesPorClave.has(clave)) return [];
    existentesPorClave.add(clave);
    const revisar = [
      entrada.driver1 && !driverId ? `Chofer de planilla: ${entrada.driver1}` : "",
      entrada.driver2 ? `Segunda persona: ${entrada.driver2}` : "",
      entrada.status
    ].filter(Boolean).join(" · ");
    return [{
      id: randomUUID(),
      serviceDate: entrada.serviceDate,
      kind: entrada.kind,
      routeName: entrada.routeName,
      shift: entrada.shift,
      driverId,
      vehicleId: null,
      companion: entrada.driver2 || null,
      notes: `Importado de ${entrada.sheet}, fila ${entrada.row}.`,
      review: revisar || null,
      source: { sheet: entrada.sheet, row: entrada.row, vehicle: entrada.vehicle, status: entrada.status, driver1: entrada.driver1, driver2: entrada.driver2 }
    }];
  });

  if (nuevas.length) {
    await prisma.schoolRun.createMany({ data: nuevas });
  }
  revalidatePath("/admin");
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath("/admin/escolares");
  revalidatePath("/admin/escolares/semana");
  const mensaje = `Importados ${nuevas.length} servicios de Concesiones. Omitidos ${omitidas.vuelos} vuelos y ${omitidas.novedades} francos/licencias. Los choferes sin usuario quedaron para revisar.`;
  redirect("/admin/escolares/semana?aviso=" + encodeURIComponent(mensaje));
}
