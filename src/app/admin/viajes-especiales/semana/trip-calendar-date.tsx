"use client";

import { useSearchParams } from "next/navigation";
import { calendarWeekStart } from "@/lib/admin/weekly-calendar";

export function TripCalendarDate({ start }: { start: string }) {
  const week = calendarWeekStart(useSearchParams().get("semana")) ?? start;
  // La semana se elige en la barra del calendario (‹ Anterior · Semana · Siguiente ›); los filtros la conservan.
  return <input key={week} name="semana" type="hidden" defaultValue={week} />;
}
