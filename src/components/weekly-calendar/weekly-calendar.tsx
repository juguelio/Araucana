"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { calendarDayDistance, calendarWindow, type CalendarWeek } from "@/lib/admin/weekly-calendar";
import { etiquetaDeSemana, fechaUTC, lunesDe, sumarDias } from "@/lib/school-runs/week";
import "./weekly-calendar.css";

const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
const MAX_VISIBLE_WEEKS = 9;
const fullDate = new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeZone: "UTC" });

type Props = {
  start: string;
  today: string;
  initial: CalendarWeek;
  dataUrl: string;
  label: string;
  singular: string;
  plural: string;
  empty: string;
};

function columnStride(scroller: HTMLDivElement) {
  const grid = scroller.firstElementChild as HTMLDivElement;
  return grid.children[1].getBoundingClientRect().left - grid.children[0].getBoundingClientRect().left;
}

export function WeeklyCalendar({ start, today, initial, dataUrl, label, singular, plural, empty }: Props) {
  const [range, setRange] = useState({ start, end: start });
  const [visibleWeek, setVisibleWeek] = useState(start);
  const [weeks, setWeeks] = useState<Record<string, CalendarWeek>>({ [start]: initial });
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const requests = useRef(new Map<string, AbortController>());
  const fetched = useRef(new Set([start]));
  const failed = useRef(new Set<string>());
  const previousStart = useRef(range.start);
  const targetDate = useRef<string | null>(start);
  const strideBeforeResize = useRef(0);

  const loadWeek = useCallback(async (week: string) => {
    if (requests.current.has(week) || fetched.current.has(week) || failed.current.has(week)) return;
    const controller = new AbortController();
    requests.current.set(week, controller);
    const url = new URL(dataUrl, window.location.origin);
    url.searchParams.set("semana", week);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("No se pudo cargar la semana");
      const data: CalendarWeek = await response.json();
      if (controller.signal.aborted) return;
      fetched.current.add(week);
      setWeeks((current) => ({ ...current, [week]: data }));
    } catch {
      if (controller.signal.aborted) return;
      failed.current.add(week);
      setErrors((current) => ({ ...current, [week]: true }));
    } finally {
      if (requests.current.get(week) === controller) requests.current.delete(week);
    }
  }, [dataUrl]);

  useLayoutEffect(() => {
    const pending = requests.current;
    return () => {
      for (const request of pending.values()) request.abort();
      pending.clear();
    };
  }, []);

  const dayCount = calendarDayDistance(range.start, range.end) + 7;
  const syncScroll = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const stride = columnStride(node);
    if (stride <= 0) return;
    const left = Math.max(0, node.scrollLeft);
    const first = Math.floor(left / stride);
    const last = Math.min(dayCount - 1, Math.floor((left + node.clientWidth - 1) / stride));
    const leading = Math.min(dayCount - 1, Math.round(left / stride));
    setVisibleWeek(lunesDe(sumarDias(range.start, leading)));

    for (let index = Math.floor(Math.max(0, first - 1) / 7); index <= Math.floor(Math.min(dayCount - 1, last + 1) / 7); index++) {
      void loadWeek(sumarDias(range.start, index * 7));
    }
    if (first < 2 || last >= dayCount - 2) {
      const capped = dayCount >= MAX_VISIBLE_WEEKS * 7;
      setRange((current) => {
        if (current !== range) return current;
        return first < 2
          ? { start: sumarDias(range.start, -7), end: capped ? sumarDias(range.end, -7) : range.end }
          : { start: capped ? sumarDias(range.start, 7) : range.start, end: sumarDias(range.end, 7) };
      });
    }
  }, [dayCount, loadWeek, range]);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (range.start === range.end) {
      setRange(calendarWindow(start));
      return;
    }
    const stride = columnStride(node);
    if (stride <= 0) return;
    if (targetDate.current) {
      node.scrollLeft = calendarDayDistance(range.start, targetDate.current) * stride;
      targetDate.current = null;
    } else if (previousStart.current !== range.start) {
      // Las columnas agregadas a la izquierda desplazan la misma fecha visible, no la reemplazan.
      node.scrollLeft += calendarDayDistance(range.start, previousStart.current) * stride;
    }
    previousStart.current = range.start;
    strideBeforeResize.current = stride;
    syncScroll();
  }, [range, start, syncScroll]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      const stride = columnStride(node);
      if (stride > 0 && strideBeforeResize.current > 0 && stride !== strideBeforeResize.current) {
        node.scrollLeft *= stride / strideBeforeResize.current;
        strideBeforeResize.current = stride;
      }
      syncScroll();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [syncScroll]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("semana") === visibleWeek) return;
    url.searchParams.set("semana", visibleWeek);
    window.history.replaceState(null, "", url);
  }, [visibleWeek]);

  function goTo(week: string) {
    const node = scroller.current;
    if (!node) return;
    if (week < range.start || week > range.end) {
      targetDate.current = week;
      setRange(calendarWindow(week));
    } else {
      node.scrollLeft = calendarDayDistance(range.start, week) * columnStride(node);
      syncScroll();
    }
  }

  function retry(week: string) {
    failed.current.delete(week);
    setErrors((current) => ({ ...current, [week]: false }));
    void loadWeek(week);
  }

  const todayWeek = lunesDe(today);
  const summary = weeks[visibleWeek]?.summary;
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = sumarDias(range.start, index);
    const week = sumarDias(range.start, Math.floor(index / 7) * 7);
    return { date, week, data: weeks[week]?.days[index % 7] };
  });

  return (
    <section className="weekly-calendar" aria-label={label}>
      <nav className="weekly-calendar-nav" aria-label="Navegación del calendario">
        <button className="ghost-button" type="button" onClick={() => goTo(sumarDias(visibleWeek, -7))}>‹ Semana anterior</button>
        <strong>{etiquetaDeSemana(visibleWeek)}</strong>
        <button className="ghost-button" type="button" onClick={() => goTo(sumarDias(visibleWeek, 7))}>Semana siguiente ›</button>
        {visibleWeek !== todayWeek && <button className="ghost-button" type="button" onClick={() => goTo(todayWeek)}>Esta semana</button>}
      </nav>

      {initial.summary && (
        <dl className="weekly-calendar-summary" aria-label="Resumen de la semana visible">
          {initial.summary.map(({ label: name }, index) =>
            <div key={name}><dt>{name}</dt><dd>{summary?.[index]?.value ?? "—"}</dd></div>
          )}
        </dl>
      )}
      {errors[visibleWeek] && (
        <p className="weekly-calendar-error" role="status">
          No se pudo cargar la semana. <button className="ghost-button" type="button" onClick={() => retry(visibleWeek)}>Reintentar</button>
        </p>
      )}
      <div className="weekly-calendar-scroll" ref={scroller} onScroll={syncScroll} tabIndex={0}
        role="region" aria-label="Días del calendario. Desplazamiento horizontal">
        <div className="weekly-calendar-grid">
          {days.map(({ date, week, data }) => {
            const day = fechaUTC(date)!;
            return (
              <article key={date} className="weekly-calendar-day" data-date={date} data-today={date === today}
                aria-label={fullDate.format(day)} aria-busy={!data && !errors[week]}>
                <header><span>{weekday.format(day)}</span><strong>{day.getUTCDate()}</strong><small>{month.format(day)}</small></header>
                <p className="weekly-calendar-count">
                  {!data ? (errors[week] ? "Semana sin cargar" : "Cargando…") :
                    data.cards.length ? `${data.cards.length} ${data.cards.length === 1 ? singular : plural}` : empty}
                </p>
                <div className="weekly-calendar-cards">
                  {data?.cards.map(({ id, href, kicker, title, details, status }) => (
                    <Link key={id} className="weekly-calendar-card" href={href} prefetch={false}>
                      {kicker && <span className="weekly-calendar-kicker">{kicker}</span>}
                      <strong>{title}</strong>
                      {details.map((line, index) => <span key={index}>{line}</span>)}
                      {status && <span className="weekly-calendar-status" data-tone={status.tone}>{status.label}</span>}
                    </Link>
                  ))}
                </div>
                {data?.href && <Link className="weekly-calendar-day-link" href={data.href} prefetch={false}>Ver el día →</Link>}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
