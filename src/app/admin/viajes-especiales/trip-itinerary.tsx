import { emptyLeg, pointsForLeg, timezones, type Leg, type TripPoint } from "@/lib/special-trips/data";
import styles from "./trip-form.module.css";

type Props = {
  legs: Leg[];
  setLegs: (legs: Leg[]) => void;
  serviceDate: string;
  endDate: string;
  setServiceDate: (date: string) => void;
  setEndDate: (date: string) => void;
  currency: string;
  showDescriptions: boolean;
};

export function TripItinerary({ legs, setLegs, serviceDate, endDate, setServiceDate, setEndDate, currency, showDescriptions }: Props) {
  function changeLeg(index: number, changes: Partial<Leg>) {
    setLegs(legs.map((leg, i) => i === index ? { ...leg, ...changes } : leg));
  }

  function place(label: string, index: number, field: "origin" | "destination", placeholder: string) {
    return <label className="trip-search-field">
      <span className="trip-search-label">{label}</span>
      <span className="trip-search-chip">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>
        <input maxLength={500} value={legs[index][field]} placeholder={placeholder}
          onChange={(event) => changeLeg(index, { [field]: event.target.value })} />
      </span>
    </label>;
  }

  return (
    <section className={styles.itinerary} aria-label="Fechas e itinerario">
      <div className={`trip-search-bar ${styles.itineraryBar}`}>
        {place("Desde", 0, "origin", "Ingresá el origen")}
        {place("Hacia", legs.length - 1, "destination", "Ingresá el destino final")}
        <label className="trip-search-field">
          <span className="trip-search-label">Fecha de inicio</span>
          <input name="serviceDate" type="date" required value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} />
        </label>
        <label className={`trip-search-field ${endDate ? "" : "trip-search-add"}`}>
          <span className="trip-search-label">Fecha de fin <small>(opcional)</small></span>
          <input name="endDate" type="date" min={serviceDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
      </div>

      {showDescriptions ? (
        <section className={`plain-card admin-section ${styles.section}`} aria-labelledby="trip-original-itinerary">
          <h2 id="trip-original-itinerary">Itinerario registrado</h2>
          <p className={`muted ${styles.pointHint}`}>Este viaje tiene recorridos guardados como texto. Si el texto indica origen y destino, podés completarlos en «Desde» y «Hacia».</p>
          <div className="admin-form-grid">
            {legs.map((leg, index) => (
              <label className="span-2" key={index}>
                {legs.length > 1 ? `Descripción del recorrido ${index + 1}` : "Descripción del recorrido"}
                <textarea rows={3} maxLength={4000} value={leg.description} onChange={(event) => changeLeg(index, { description: event.target.value })} />
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <div className={`plain-card admin-section ${styles.section}`}>
        <h2>Puntos intermedios</h2>
        <p className={`muted ${styles.pointHint}`}>El importe de cada punto es informativo. El total del viaje se carga en «Precio y cobros».</p>
        {legs.map((leg, legIndex) => {
          const points = pointsForLeg(leg);
          const savePoints = (next: TripPoint[]) => changeLeg(legIndex, { points: next, stops: "" });
          return <div key={legIndex} className={styles.pointGroup}>
            {legs.length > 1 ? <h3>{[leg.origin, leg.destination].filter(Boolean).join(" → ") || `Recorrido ${legIndex + 1}`}</h3> : null}
            {points.map((point, index) => {
              const change = (patch: Partial<TripPoint>) => savePoints(points.map((item, i) => i === index ? { ...item, ...patch } : item));
              return <div className={`admin-form-grid ${styles.pointRow}`} key={index} role="group" aria-label={`Punto ${index + 1}`}>
                <label>Lugar<input maxLength={500} required value={point.name} onChange={(event) => change({ name: event.target.value })} /></label>
                <label>Fecha (opcional)<input type="date" value={point.date} onChange={(event) => change({ date: event.target.value })} /></label>
                <label>Importe opcional ({currency})<input inputMode="decimal" value={point.amount} onChange={(event) => change({ amount: event.target.value })} /></label>
                <button className="ghost-button" type="button" aria-label={`Quitar punto ${index + 1}`} onClick={() => savePoints(points.filter((_, i) => i !== index))}>Quitar</button>
              </div>;
            })}
            <button className={`trip-search-field trip-search-add ${styles.addPoint}`} type="button" disabled={points.length >= 50}
              onClick={() => savePoints([...points, { name: "", date: "", amount: "" }])}>
              <span className="trip-search-value"><span className="trip-search-add-icon" aria-hidden="true">+</span>Agregar punto intermedio</span>
            </button>
          </div>;
        })}
        <details className={styles.legDetails} open={legs.length > 1 || undefined}>
          <summary>Recorridos, horarios y otras opciones</summary>
          {legs.map((leg, index) => {
            const change = (patch: Partial<Leg>) => changeLeg(index, patch);
            return <fieldset key={index} className="admin-form-grid">
              <legend>Recorrido {index + 1}</legend>
              {index > 0 ? <label>Origen del recorrido<input maxLength={500} value={leg.origin} onChange={(event) => change({ origin: event.target.value })} /></label> : null}
              {index < legs.length - 1 ? <label>Destino del recorrido<input maxLength={500} value={leg.destination} onChange={(event) => change({ destination: event.target.value })} /></label> : null}
              <label>Salida<input type="datetime-local" value={leg.departure} onChange={(event) => change({ departure: event.target.value })} /></label>
              <label>Llegada<input type="datetime-local" value={leg.arrival} onChange={(event) => change({ arrival: event.target.value })} /></label>
              <label>País<select value={leg.country} onChange={(event) => change({ country: event.target.value as Leg["country"] })}><option value="AR">Argentina</option><option value="CL">Chile</option><option value="AR_CL">Argentina y Chile</option></select></label>
              <label>Zona horaria de salida<select value={leg.zone} onChange={(event) => change({ zone: event.target.value as Leg["zone"] })}>{timezones.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
              <label>Zona horaria de llegada<select value={leg.arrivalZone ?? ""} onChange={(event) => change({ arrivalZone: (event.target.value || undefined) as Leg["arrivalZone"] })}>
                <option value="">La misma que la salida</option>{timezones.map((zone) => <option key={zone}>{zone}</option>)}
              </select></label>
              <label className={styles.checkbox}><input type="checkbox" checked={leg.included} onChange={(event) => change({ included: event.target.checked })} /> Incluido en el paquete</label>
              {!showDescriptions ? <label className="span-2">Descripción<textarea maxLength={4000} value={leg.description} onChange={(event) => change({ description: event.target.value })} /></label> : null}
              {legs.length > 1 && <button type="button" className="ghost-button" onClick={() => setLegs(legs.filter((_, i) => i !== index))}>Quitar recorrido {index + 1}</button>}
            </fieldset>;
          })}
          <button type="button" className="ghost-button" disabled={legs.length >= 200} onClick={() => {
            const last = legs.at(-1)!;
            setLegs([...legs, { ...emptyLeg, origin: last.destination, zone: last.arrivalZone ?? last.zone, country: last.country }]);
          }}>Agregar recorrido</button>
        </details>
      </div>
    </section>
  );
}
