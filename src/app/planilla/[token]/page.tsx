import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { getCountryOptions } from "@/lib/booking/nationality-countries";
import { getDepartureSheetByToken } from "@/lib/departure-sheets/repository";
import { departureSheetCopy, isDepartureSheetKind, type DepartureSheetKind } from "@/lib/departure-sheets/types";
import { PlanillaForm } from "./form";
import "./planilla.css";

export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
  title: "Planilla de salida · La Araucana Viajes"
};

export const dynamic = "force-dynamic";

function formatDay(value: Date | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "America/Argentina/Salta" }).format(value);
}

export default async function DepartureSheetPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sheet = await getDepartureSheetByToken(token);

  if (!sheet) {
    notFound();
  }

  const kind: DepartureSheetKind = isDepartureSheetKind(sheet.kind) ? sheet.kind : "DUT";
  const copy = departureSheetCopy[kind];
  const reservation = sheet.reservation;
  const departureAt =
    reservation.schedule?.departureAt ?? reservation.chapelcoDetails?.serviceDate ?? reservation.airportDetails?.serviceDate ?? null;
  const day = formatDay(departureAt);
  const routeLabel = reservation.route
    ? `${reservation.route.from} - ${reservation.dropoffStop ?? reservation.route.to}`
    : "Traslado";

  return (
    <>
      <main className="page-shell section planilla-page">
        <section className="planilla-hero">
          <p className="eyebrow">La Araucana Viajes · Reserva {reservation.code}</p>
          <h1 className="section-title">{copy.shortLabel}</h1>
          <p className="lead">{copy.label}</p>
          <div className="planilla-datos">
            <div>
              <span>Ruta</span>
              <strong>{routeLabel}</strong>
            </div>
            {day ? (
              <div>
                <span>Fecha de salida</span>
                <strong>{day}</strong>
              </div>
            ) : null}
            <div>
              <span>Pasajeros en la planilla</span>
              <strong>{sheet.passengers.length}</strong>
            </div>
          </div>
        </section>

        <section className="planilla-copy">
          <p>{copy.passengerIntro}</p>
          <p className="muted">{copy.passengerNote}</p>
        </section>

        {sheet.isOpen ? (
          <PlanillaForm
            token={sheet.token}
            kind={kind}
            countries={getCountryOptions()}
            prefill={{
              firstName: reservation.passenger.firstName,
              lastName: reservation.passenger.lastName,
              documentType: reservation.passenger.documentType,
              documentNumber: reservation.passenger.documentId,
              nationality: reservation.passenger.nationality ?? ""
            }}
          />
        ) : (
          <section className="form-panel planilla-panel">
            <p className="eyebrow">Planilla cerrada</p>
            <h2>Esta planilla ya no recibe datos</h2>
            <p>
              La agencia cerró la carga de esta planilla. Si necesitás corregir o agregar un pasajero,
              escribinos y lo resolvemos desde la oficina.
            </p>
          </section>
        )}

        <p className="muted planilla-pie">
          Los datos se usan sólo para la documentación del viaje (DUT / registro de salida) y quedan en
          poder de La Araucana Viajes. Si cargaste mal un dato, volvé a entrar con el mismo link y tu
          documento: se actualiza solo.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
