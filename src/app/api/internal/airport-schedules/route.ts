import { authenticateScheduleWorkflow } from "@/lib/airport/schedule-workflow";
import { airportLocalDay } from "@/lib/airport/data-quality";
import { prisma } from "@/lib/db/prisma";
import { applySchedules } from "../../../../../scripts/airport/apply-schedules.mjs";

export const maxDuration = 120;

export async function POST(request: Request) {
  if (!await authenticateScheduleWorkflow(request.headers.get("authorization"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  const payload = await request.json();
  const now = new Date();
  const today = airportLocalDay(now);
  const lastDay = airportLocalDay(new Date(now.getTime() + 35 * 86400000));
  if (payload?.asOf !== today || !Array.isArray(payload.flights) || !Array.isArray(payload.coverage) ||
      !payload.flights.length || [...payload.flights, ...payload.coverage].some(
        row => !row || typeof row.date !== "string" || row.date <= today || row.date > lastDay
      )) {
    return Response.json({ error: "Lote fuera del período de programación." }, { status: 400 });
  }
  const { runId, counts, warnings } = await applySchedules(prisma, payload, { apply: true, now });
  return Response.json({ runId, counts, warnings });
}
