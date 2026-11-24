import { calendarWeekResponse } from "@/lib/admin/weekly-calendar-response";
import { leerTerminalSemanal, loadPublicServiceWeek } from "../data";

export async function GET(request: Request) {
  return calendarWeekResponse(request, (start, params) => loadPublicServiceWeek(start, leerTerminalSemanal(params.get("terminal"))));
}
