import { createHash } from "node:crypto";
import { AREA_LABEL, localDateKey } from "./day-board";
import type { DispatchAssignment } from "./dispatch";

const clock = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Salta", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
export function driverPlan(date: string, name: string, jobs: DispatchAssignment[]) {
  const stamp = (ms: number) => {
    const key = localDateKey(new Date(ms));
    return (key === date ? "" : key.slice(5).split("-").reverse().join("/") + " ") + clock.format(ms);
  };
  const sorted = [...jobs].sort((a,b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.key.localeCompare(b.key));
  const lines = sorted.map(job => {
    const time = job.start === null ? job.shift || "Hora a coordinar" :
      stamp(job.start) + (job.end === null ? "" : " – " + stamp(job.end));
    return [time, AREA_LABEL[job.area] + " · " + job.title, job.detail, job.vehicleName,
      job.coDriverName && [job.driverName, job.coDriverName].filter(Boolean).join(" y "),
      job.estimatedWindow && "Horario estimado", job.cancelled && "Servicio interrumpido"].filter(Boolean).join(" · ");
  });
  const message = ["Jornada del " + date.split("-").reverse().join("/") + " · " + name,
    ...(lines.length ? lines : ["Sin servicios asignados para este día."])].join("\n");
  const fingerprint = createHash("sha256").update(JSON.stringify([message, sorted.map(job => [job.rowKey, job.vehicleId, job.coDriverId])])).digest("hex");
  return { message, fingerprint };
}
