import { ORDER_LOGO_PNG_BASE64 } from "@/lib/airport/service-order-logo";
import { argentina, pointsForLeg, statuses, tripContactLabel, type Leg } from "@/lib/special-trips/data";
import { ultimoDia } from "@/lib/special-trips/rango";
import type { SpecialTripOrder } from "@/lib/special-trips/service-order";
import { CabeceraOrden } from "./service-order-header";
import "./service-order-sheet.css";
import styles from "./special-trip-order-sheet.module.css";

const calendar = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "UTC" });
const shiftTime = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short", timeStyle: "short", hourCycle: "h23", timeZone: argentina
});
const zones = {
  [argentina]: "Argentina", "America/Santiago": "Santiago", "America/Coyhaique": "Coyhaique",
  "America/Punta_Arenas": "Punta Arenas"
};

function legTime(value: string, zone: Leg["zone"]) {
  const [date, time] = value.split("T");
  return time ? `${date.split("-").reverse().join("/")} · ${time} (${zones[zone]})` : value;
}

function legTitle({ origin, destination }: Leg, number: number) {
  if (origin && destination) return `${origin} → ${destination}`;
  if (origin) return `Desde ${origin}`;
  if (destination) return `Hasta ${destination}`;
  return `Tramo ${number}`;
}

export function SpecialTripOrderSheet({ trip }: { trip: SpecialTripOrder }) {
  const dates = calendar.formatRange(trip.serviceDate, ultimoDia(trip));
  const status = statuses[trip.status as keyof typeof statuses] ?? trip.status;

  return (
    <article className={`orden ${styles.sheet}`}>
      <CabeceraOrden fecha={dates} subtitulo="Viaje especial" logoSrc={`data:image/png;base64,${ORDER_LOGO_PNG_BASE64}`} />
      <p className={styles.label}>Cliente o grupo</p>
      <h2 className={styles.client}>{trip.client}</h2>
      <dl className={styles.summary}>
        <div><dt>Estado del viaje</dt><dd>{status}</dd></div>
        <div><dt>Pasajeros del grupo</dt><dd>{trip.passengers ?? "Por confirmar"}</dd></div>
        <div><dt>Contacto del grupo</dt><dd>{trip.contactPhone
          ? <>{trip.contactName && <>{trip.contactName} · </>}<a href={`tel:${trip.contactPhone.replace(/[^+\d]/g, "")}`}>{trip.contactPhone}</a></>
          : tripContactLabel(trip) || "Sin registrar"}</dd></div>
      </dl>

      <section>
        <h2 className={styles.sectionTitle}>Naves y choferes</h2>
        {trip.assignments.length ? <ul className={styles.assignments}>{trip.assignments.map(({ id, driver, vehicle, startsAt, endsAt }) => (
          <li key={id}>
            <div>
              <small>Chofer</small>
              <strong>{driver ? driver.name || driver.email : "Chofer sin asignar"}</strong>
              <p>{vehicle.name}{vehicle.internalNumber && ` · Interno ${vehicle.internalNumber}`}{vehicle.licensePlate && ` · Patente ${vehicle.licensePlate}`}</p>
              {vehicle.owner && <p>Titular de la nave · {vehicle.owner}</p>}
            </div>
            <div><small>Turno de la nave (hora argentina)</small><p>{shiftTime.formatRange(startsAt, endsAt)}</p></div>
          </li>
        ))}</ul> : <p>Nave y chofer pendientes de asignación.</p>}
      </section>

      <section>
        <h2 className={styles.sectionTitle}>Itinerario</h2>
        {trip.legs.length ? <ol className={styles.legs}>{trip.legs.map((leg, index) => {
          const stops = pointsForLeg(leg);
          return (
            <li key={index}>
              <h3>{legTitle(leg, index + 1)}</h3>
              {leg.country !== "AR" && <p>{leg.country === "CL" ? "Chile" : "Argentina y Chile"}</p>}
              {(leg.departure || leg.arrival) && <dl className={styles.times}>
                {leg.departure && <div><dt>Salida</dt><dd>{legTime(leg.departure, leg.zone)}</dd></div>}
                {leg.arrival && <div><dt>Llegada</dt><dd>{legTime(leg.arrival, leg.arrivalZone ?? leg.zone)}</dd></div>}
              </dl>}
              {leg.description && <p className={styles.text}>{leg.description}</p>}
              {stops.length > 0 && <>
                <h4>Paradas intermedias</h4>
                <ul>{stops.map((stop, i) => <li key={i}>{stop.name}{stop.date && ` · ${stop.date.split("-").reverse().join("/")}`}</li>)}</ul>
              </>}
            </li>
          );
        })}</ol> : <p className={styles.text}>{trip.destinationSearch || "Itinerario pendiente de carga."}</p>}
      </section>

      {trip.notes && <section>
        <h2 className={styles.sectionTitle}>Observaciones</h2>
        <p className={styles.text}>{trip.notes}</p>
      </section>}
      <footer className={styles.signature}>Firma del chofer</footer>
    </article>
  );
}
