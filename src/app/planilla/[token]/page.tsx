import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { getCountryOptions } from "@/lib/booking/nationality-countries";
import { parseTripLegs } from "@/lib/departure-sheets/applicability";
import { getDepartureSheetByToken } from "@/lib/departure-sheets/repository";
import {
  departureSheetCopy,
  documentTypeLabels,
  formatServiceDay,
  isDepartureSheetKind,
  passengerFullName,
  type DepartureSheetKind,
  type DocumentType
} from "@/lib/departure-sheets/types";
import { PlanillaForm } from "./form";
import "./planilla.css";

export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
  title: "Planilla de salida · La Araucana Viajes"
};

export const dynamic = "force-dynamic";

export default async function DepartureSheetPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sheet = await getDepartureSheetByToken(token);

  if (!sheet) {
    notFound();
  }

  const kind: DepartureSheetKind = isDepartureSheetKind(sheet.kind) ? sheet.kind : "DUT";
  const copy = departureSheetCopy[kind];
  const trip = sheet.specialTrip;
  const day = formatServiceDay(trip.serviceDate);
  const legs = parseTripLegs(trip.legs);
  const destino =
    legs.map((leg) => leg.destination || leg.description).filter(Boolean).join(" · ") ||
    trip.destinationSearch.replaceAll("\n", " · ");
  const maskDocument = (value: string) => value.length > 3 ? `${"•".repeat(Math.min(6, value.length - 3))}${value.slice(-3)}` : "•••";

  return (
    <>
      <main className="page-shell section planilla-page">
        <section className="planilla-hero">
          <p className="eyebrow">La Araucana Viajes · Viaje del {day}</p>
          <h1 className="section-title">{copy.shortLabel}</h1>
          <p className="lead">{copy.label}</p>
          <div className="planilla-datos">
            {destino ? (
              <div>
                <span>Destino</span>
                <strong>{destino}</strong>
              </div>
            ) : null}
            <div>
              <span>Fecha del viaje</span>
              <strong>{day}</strong>
            </div>
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

        {sheet.passengers.length > 0 ? (
          <section className="planilla-lista" aria-labelledby="pasajeros-cargados">
            <div className="planilla-lista-head">
              <div>
                <p className="eyebrow">Planilla</p>
                <h2 id="pasajeros-cargados">Pasajeros cargados</h2>
              </div>
              <span className="pill">{sheet.passengers.length}</span>
            </div>
            <ol className="planilla-pasajeros">
              {sheet.passengers.map((passenger) => (
                <li key={passenger.id}>
                  <span className="planilla-pasajero-num">{passenger.position}</span>
                  <div>
                    <strong>{passengerFullName(passenger)}</strong>
                    <span>
                      {documentTypeLabels[passenger.documentType as DocumentType] ?? passenger.documentType}{" "}
                      {maskDocument(passenger.documentNumber)} · {passenger.nationality}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <p className="muted planilla-lista-nota">
              Si ves tus datos repetidos o con un error, volvé a cargarlos con el mismo documento: se actualizan.
            </p>
          </section>
        ) : null}

        {sheet.isOpen ? (
          <PlanillaForm token={sheet.token} kind={kind} countries={getCountryOptions()} />
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
