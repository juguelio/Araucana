import { calendarWeekResponse } from "@/lib/admin/weekly-calendar-response";
import { leerTipoDeConcesion } from "@/lib/school-runs/kinds";
import { loadConcesionesWeek } from "../data";

export async function GET(request: Request) {
  return calendarWeekResponse(request, (start, params) => loadConcesionesWeek(start, leerTipoDeConcesion(params.get("tipo"))));
}
