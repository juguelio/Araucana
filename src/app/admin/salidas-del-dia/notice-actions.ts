"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { isDateKey, personName } from "@/lib/operations/day-board";
import { readDispatchDays } from "@/lib/operations/dispatch-days";
import { driverPlan } from "@/lib/operations/driver-plan";

export async function markDriverNotified(date: string, driverId: string, submitted: string, previous: string | null, pendingOnly = false) {
  const actor = await getCurrentAdminOrRedirect();
  if (!isDateKey(date)) redirect("/admin");
  const back = (notice: string) => redirect("/admin?" + new URLSearchParams({ date, vista: "flota", tipo: "chofer", recurso: driverId, ...(pendingOnly ? { avisos: "pendientes" } : {}), notice }));
  const [driver, [day]] = await Promise.all([
    prisma.user.findFirst({ where: { id: driverId, role: "DRIVER" }, select: { id: true, name: true, email: true } }),
    readDispatchDays(date)
  ]);
  if (!driver) return back("El chofer ya no figura en el equipo.");
  const jobs = day.assignments.filter(a => (a.driverId === driverId || a.coDriverId === driverId) && !a.programmed);
  const name = personName(driver)!;
  const { fingerprint } = driverPlan(date, name, jobs);
  if (submitted !== fingerprint) return back("La jornada cambió. Revisá el nuevo mensaje antes de marcar el aviso.");
  const key = { serviceDate: new Date(date), driverId };
  const data = { fingerprint, notifiedAt: new Date(), notifiedBy: actor.name?.trim() || actor.email };
  const saved = previous
    ? await prisma.driverPlanNotice.updateMany({ where: { ...key, fingerprint: previous }, data })
    : await prisma.driverPlanNotice.createMany({ data: [{ ...key, ...data }], skipDuplicates: true });
  revalidatePath("/admin");
  back(saved.count ? "Aviso registrado para " + name + "." : "Otra persona ya actualizó el aviso. Revisá su estado.");
}
