import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { prisma } from "@/lib/db/prisma";
import { sumarDias } from "@/lib/school-runs/week";
import { BarraDelDia, Cifras, ROTULO_DE_SERVICIOS, textoDeAsignar } from "@/components/modulo/modulo";
import { statuses } from "@/lib/special-trips/data";
import { navesDelDia, salidaDelDia } from "@/lib/special-trips/dia";
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
        orderBy: { startsAt: "asc" },
        select: { startsAt: true, endsAt: true, driverId: true, vehicle: { select: { name: true } }, driver: { select: { name: true, email: true } } }
      }
    }
  });
  const [vehiculos, choferes] = await Promise.all([
    prisma.vehicle.findMany({ where: { isActive: true, kind: { not: "UTILITARIO" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { role: "DRIVER", isActive: true }, orderBy: [{ name: "asc" }, { email: "asc" }], select: { id: true, name: true, email: true } })
  ]);

  // Activos en el día: los cancelados no cuentan como pendientes.
  const activos = trips.filter((trip) => ["PENDING", "CONFIRMED"].includes(trip.status));
  const sinNave = activos.filter((trip) => trip.assignments.length === 0).length;
  const sinChoferDia = activos.filter((trip) => trip.assignments.some(({ driverId }) => !driverId)).length;

  return (
    <AdminShell title="Viajes especiales" eyebrow={ROTULO_DE_SERVICIOS} role={user.role}
      action={<div className="inline-actions">
        <Link className="ghost-button" href={`${base}/importar`}>Importar</Link>
        <Link className="button" href={`${base}/nuevo?fecha=${clave}`}>Nuevo viaje</Link>
      </div>}>
      <SpecialTripsViewTabs active="dia" fecha={clave} />
      <BarraDelDia
        accion={`${base}/dia`}
        nombre="fecha"
        fecha={clave}
        anterior={`${base}/dia?fecha=${sumarDias(clave, -1)}`}
        siguiente={`${base}/dia?fecha=${sumarDias(clave, 1)}`}
      />
      <Cifras
        cifras={[
          { rotulo: "Viajes", valor: trips.length },
          { rotulo: "Pasajeros", valor: trips.reduce((total, trip) => total + (trip.passengers ?? 0), 0) },
          { rotulo: "Sin nave", valor: sinNave, alerta: sinNave > 0 },
          { rotulo: "Sin chofer", valor: sinChoferDia, alerta: sinChoferDia > 0 }
        ]}
      />
      <section className="plain-card admin-section">
        <div className="inline-actions" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{fechaLarga.format(fecha)}</h2>
          <span className="muted">{trips.length} {trips.length === 1 ? "viaje" : "viajes"}</span>
        </div>
        {!trips.length ? <p className="muted">No hay viajes especiales para este día.</p> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>{["Cliente", "Estado del día", "Destino", "Nave", "Chofer", "Pax", "Estado"].map((h) => <th key={h} scope="col">{h}</th>)}<th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>{trips.map((trip) => {
                const delDia = estadoDelDia(trip, fecha);
                const naves = navesDelDia(trip.assignments, clave);
                const choferesDelDia = [...new Set(trip.assignments.flatMap(({ driver }) => driver ? [driver.name?.trim() || driver.email] : []))];
                const sinChofer = trip.assignments.length > 0 && trip.assignments.some(({ driverId }) => !driverId);
                const salida = salidaDelDia(trip.assignments, clave);
                return <tr key={trip.id}>
                  <td><Link className="table-link" href={`${base}/${trip.id}`}>{trip.client}</Link></td>
                  <td>{delDia ?? (salida ? `Sale ${hora.format(salida.startsAt)}` : "—")}</td>
                  <td>{trip.destinationSearch.trim().replace(/\s*\n\s*/g, " · ")}</td>
                  <td>{naves.length ? naves.join(", ") : <span className="vesp-falta-dato">Sin nave</span>}</td>
                  <td>{choferesDelDia.length ? choferesDelDia.join(", ") : naves.length ? <span className="vesp-falta-dato">Sin chofer</span> : "—"}{sinChofer && choferesDelDia.length ? <span className="vesp-falta-dato"> · falta uno</span> : null}</td>
                  <td>{trip.passengers ?? "—"}</td>
                  <td><span className="pill">{statuses[trip.status as keyof typeof statuses] ?? trip.status}</span></td>
                  <td>{!["PENDING", "CONFIRMED"].includes(trip.status) ? null : naves.length
                    ? <Link className="ghost-button modulo-asignar" href={`${base}/${trip.id}#naves`}>{textoDeAsignar(!sinChofer)}</Link>
                    : <NavesPendientes id={trip.id} version={trip.updatedAt.toISOString()} client={trip.client}
                        start={trip.serviceDate.toISOString().slice(0, 10)} end={(trip.endDate ?? trip.serviceDate).toISOString().slice(0, 10)}
                        label={textoDeAsignar(false)} tone="atencion" boton vehicles={vehiculos} drivers={choferes.map((chofer) => ({ id: chofer.id, name: chofer.name?.trim() || chofer.email }))} />}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
