import type { DriverServiceMark } from "@prisma/client";
import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { requireDriverUser } from "@/lib/auth/service";
import { prisma } from "@/lib/db/prisma";
import { leerComprobante } from "@/lib/driver/comprobante";
import { cargarJornadaApp } from "@/lib/driver/jornada-app";
import { marcasDeServicios } from "@/lib/driver/marcas";
import { localDateKey } from "@/lib/operations/day-board";

const entrada = z.object({
  id: z.string().uuid(), servicioId: z.string().min(1), vehicleId: z.string().min(1).nullable().default(null),
  tipo: z.enum(["inicio", "fin", "embarque"]), at: z.iso.datetime({ offset: true }),
  filaId: z.string().min(1).nullish(), cantidad: z.number().int().nonnegative().nullish(), comprobante: z.string().min(1)
});

function respuesta(guardada: DriverServiceMark, m: z.infer<typeof entrada>, driverId: string, fecha: string) {
  if (guardada.driverId !== driverId || guardada.servicioId !== m.servicioId || guardada.vehicleId !== m.vehicleId ||
      guardada.fecha !== fecha || guardada.tipo !== m.tipo || +guardada.at !== Date.parse(m.at) ||
      guardada.filaId !== (m.filaId ?? null) || guardada.cantidad !== (m.cantidad ?? null)) {
    return jsonError("MARCA_DUPLICADA", "Este identificador corresponde a otra marca.", 409);
  }
  return Response.json({ estado: guardada.estado, motivo: guardada.motivo });
}

export async function GET(request: Request) {
  try {
    const driver = await requireDriverUser(request);
    const jornada = await cargarJornadaApp(driver.id);
    const marcas = await marcasDeServicios(jornada.servicios, driver.id, jornada.fecha);
    return Response.json({ marcas }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const driver = await requireDriverUser(request);
    const parsed = entrada.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("MARCA_INVALIDA", "Revisá los datos de la marca.", 400);
    const m = parsed.data;
    const hoja = leerComprobante(m.comprobante, driver.id);
    if (!hoja || hoja.servicioId !== m.servicioId || hoja.vehicleId !== m.vehicleId) {
      return jsonError("ASIGNACION_INVALIDA", "La marca requiere la hoja emitida para tu asignación.", 403);
    }
    const at = new Date(m.at);
    if (+at > Date.now() + 60000 || localDateKey(at) !== hoja.fecha) {
      return jsonError("FECHA_INVALIDA", "La marca debe corresponder al día del servicio.", 422);
    }
    const fila = hoja.filas.find(f => f.id === m.filaId);
    if (m.tipo === "embarque" ? !m.vehicleId || !fila || m.cantidad == null || m.cantidad > fila.cantidad : m.filaId != null || m.cantidad != null) {
      return jsonError("FILA_INVALIDA", "Revisá la reserva y la cantidad informada.", 422);
    }
    const previa = await prisma.driverServiceMark.findUnique({ where: { id: m.id } });
    if (previa) return respuesta(previa, m, driver.id, hoja.fecha);
    const jornada = await cargarJornadaApp(driver.id, hoja.fecha, 1);
    const servicio = jornada.servicios.find(s => s.id === m.servicioId && (s.nave?.id ?? null) === m.vehicleId);
    const actual = servicio?.filas.find(f => f.id === m.filaId);
    let motivo: string | null = null;
    if (!servicio) motivo = "La asignación cambió desde la descarga.";
    else if (servicio.salida !== hoja.salida || servicio.fin !== hoja.fin) motivo = "El horario cambió desde la descarga.";
    else if (fila && (!actual || actual.cantidad !== fila.cantidad || actual.nombre !== fila.nombre)) motivo = "La reserva cambió desde la descarga.";
    await prisma.driverServiceMark.createMany({
      skipDuplicates: true, data: {
        id: m.id, driverId: driver.id, servicioId: m.servicioId, fecha: hoja.fecha,
        vehicleId: m.vehicleId, tipo: m.tipo, at, filaId: m.filaId ?? null, cantidad: m.cantidad ?? null,
        prevista: fila?.cantidad, fila: fila?.nombre, servicio: hoja.titulo, nave: hoja.nave,
        estado: motivo ? "revision" : "guardada", motivo
      }
    });
    const registro = await prisma.driverServiceMark.findUniqueOrThrow({ where: { id: m.id } });
    return respuesta(registro, m, driver.id, hoja.fecha);
  } catch (error) {
    return handleApiError(error);
  }
}
