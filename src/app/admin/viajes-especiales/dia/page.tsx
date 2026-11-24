import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { prisma } from "@/lib/db/prisma";
import { lunesDe } from "@/lib/school-runs/week";
import { statuses } from "@/lib/special-trips/data";
import { estadoDelDia, whereSolapa } from "@/lib/special-trips/rango";
import { NavesPendientes } from "../naves-pendientes";
import { specialTripsPath as base } from "../view";
import { SpecialTripsViewTabs } from "../view-tabs";
import "../listado.css";

export const metadata = { title: "Viajes especiales · Día · La Araucana" };

const fechaLarga = new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeZone: "UTC" });
const hora = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Salta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export default async function SpecialTripDayPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const raw = typeof params.fecha === "string" ? params.fecha : "";
  const clave = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : argentinaDateKey();
  const fecha = new Date(`${clave}T00:00:00Z`);
  const siguiente = new Date(+fecha + 86_400_000);
  const trips = await prisma.specialTrip.findMany({
    where: whereSolapa(fecha, siguiente),
    orderBy: [{ serviceDate: "asc" }, { client: "asc" }, { id: "asc" }],
    include: {
      assignments: {
        where: { startsAt: { lt: siguiente }, endsAt: { gt: fecha } },
        orderBy: { startsAt: "asc" },
        select: { startsAt: true, driverId: true, vehicle: { select: { name: true } }, driver: { select: { name: true, email: true } } }
      }
    }
  });
  const [vehiculos, choferes] = await Promise.all([
    prisma.vehicle.findMany({ where: { isActive: true, kind: { not: "UTILITARIO" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { role: "DRIVER", isActive: true }, orderBy: [{ name: "asc" }, { email: "asc" }], select: { id: true, name: true, email: true } })
  ]);

  return (
    <AdminShell title="Viajes especiales" eyebrow="Día" role={user.role}
      action={<div className="inline-actions">
        <Link className="ghost-button" href={`${base}/semana?semana=${lunesDe(clave)}`}>Volver al calendario</Link>
        <Link className="button" href={`${base}/nuevo?fecha=${clave}`}>Nuevo viaje</Link>
      </div>}>
      <SpecialTripsViewTabs active="dia" />
      <section className="plain-card admin-section">
        <div className="inline-actions" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{fechaLarga.format(fecha)}</h2>
          <span className="muted">{trips.length} {trips.length === 1 ? "viaje" : "viajes"}</span>
        </div>
        {!trips.length ? <p className="muted">No hay viajes especiales para este día.</p> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>{["Cliente", "Estado del día", "Destino", "Nave", "Chofer", "Pax", "Estado"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>{trips.map((trip) => {
                const delDia = estadoDelDia(trip, fecha);
                const naves = [...new Set(trip.assignments.map(({ vehicle }) => vehicle.name))];
                const choferesDelDia = [...new Set(trip.assignments.flatMap(({ driver }) => driver ? [driver.name?.trim() || driver.email] : []))];
                const sinChofer = trip.assignments.length > 0 && trip.assignments.some(({ driverId }) => !driverId);
                const salida = trip.assignments.find(({ startsAt }) => +startsAt >= +fecha && +startsAt < +siguiente);
                return <tr key={trip.id}>
                  <td><Link className="table-link" href={`${base}/${trip.id}`}>{trip.client}</Link></td>
                  <td>{delDia ?? (salida ? `Sale ${hora.format(salida.startsAt)}` : "—")}</td>
                  <td>{trip.destinationSearch.trim().replace(/\s*\n\s*/g, " · ")}</td>
                  <td>{naves.length ? naves.join(", ") : ["PENDING", "CONFIRMED"].includes(trip.status)
                    ? <NavesPendientes id={trip.id} version={trip.updatedAt.toISOString()} client={trip.client}
                        start={trip.serviceDate.toISOString().slice(0, 10)} end={(trip.endDate ?? trip.serviceDate).toISOString().slice(0, 10)}
                        label="Asignar nave y chofer" tone="atencion" vehicles={vehiculos} drivers={choferes.map((chofer) => ({ id: chofer.id, name: chofer.name?.trim() || chofer.email }))} />
                    : "Sin nave"}</td>
                  <td>{choferesDelDia.length ? choferesDelDia.join(", ") : sinChofer
                    ? <><span>Sin chofer</span> <Link className="table-link" href={`${base}/${trip.id}/editar`}>Asignar</Link></>
                    : "—"}</td>
                  <td>{trip.passengers ?? "—"}</td>
                  <td><span className="pill">{statuses[trip.status as keyof typeof statuses] ?? trip.status}</span></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
