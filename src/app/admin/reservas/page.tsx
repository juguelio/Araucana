import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { ReservationWorkspace, type ReservationParams } from "./reservation-workspace";

export default async function AdminReservationsPage({ searchParams }: { searchParams?: Promise<ReservationParams> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  return <AdminShell title="Reservas" notice={params?.notice} role={user.role}>
    <ReservationWorkspace params={params} role={user.role} />
  </AdminShell>;
}
