"use client";

import { useSearchParams } from "next/navigation";
import { calendarWeekStart } from "@/lib/admin/weekly-calendar";

export function TripCalendarDate({ start }: { start: string }) {
  const week = calendarWeekStart(useSearchParams().get("semana")) ?? start;
  return <label>Semana<input key={week} name="semana" type="date" defaultValue={week} required /></label>;
}
