import { calendarWeekResponse } from "@/lib/admin/weekly-calendar-response";
import { loadSpecialTripsWeek, readTripCalendarFilters } from "../data";

export async function GET(request: Request) {
  return calendarWeekResponse(request, (start, params) => loadSpecialTripsWeek(start, readTripCalendarFilters((key) => params.get(key))));
}
