import { isOfficeRole } from "@/lib/auth/roles";
import { getAppUserFromToken, getTokenFromRequest } from "@/lib/auth/service";
import { calendarWeekStart, type CalendarWeek } from "./weekly-calendar";

export async function calendarWeekResponse(
  request: Request,
  load: (start: string, params: URLSearchParams) => Promise<CalendarWeek>
) {
  const user = await getAppUserFromToken(getTokenFromRequest(request));
  if (!user?.isActive || !isOfficeRole(user.role)) {
    return Response.json({ error: "No autorizado" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const params = new URL(request.url).searchParams;
  const start = calendarWeekStart(params.get("semana"));
  if (!start) return Response.json({ error: "Semana inválida" }, { status: 400 });
  return Response.json(await load(start, params), { headers: { "Cache-Control": "private, no-store" } });
}
