import { DayWorkspace, type DayParams } from "./day-workspace";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";

export default async function DayBoardPage({ searchParams }: { searchParams?: Promise<DayParams> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  return <DayWorkspace user={user} params={await searchParams} />;
}
