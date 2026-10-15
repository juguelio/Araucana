import { moveDriverStopAction, updateDriverStopStatusAction } from "./chapelco-actions";

type DriverRun = {
  id: string;
  direction: string;
  ascentSlot: string | null;
  sequence: number;
  vehicleDuty: {
    vehicle: {
      name: string;
      licensePlate: string | null;
    };
  };
  stops: Array<{
    id: string;
    stopOrder: number;
    passengerCount: number;
    pickupName: string;
    pickupAddress: string;
    status: string;
    reservation: {
      ticket: { code: string } | null;
      passenger: {
        firstName: string;
        lastName: string;
        phone: string;
      };
    };
  }>;
};

function whatsappHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export function ChapelcoDriverPanel({ runs }: { runs: DriverRun[] }) {
  if (runs.length === 0) {
    return null;
  }

  return (
    <section className="plain-card admin-section">
      <div>
        <p className="eyebrow">Chapelco</p>
        <h2 className="route-title">Recorridos asignados</h2>
      </div>
      <div className="driver-run-list">
        {runs.map((run) => (
          <div className="manifest-block" key={run.id}>
            <h3>
              {run.vehicleDuty.vehicle.name} · {run.direction === "UP" ? `Subida ${run.ascentSlot}` : `Bajada ${run.sequence}`}
            </h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Responsable</th>
                  <th>Busqueda</th>
                  <th>Personas</th>
                  <th>Estado</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                {run.stops.map((stop) => {
                  const passenger = stop.reservation.passenger;
                  const whatsappUrl = whatsappHref(passenger.phone);
                  const positiveStatus = run.direction === "UP" ? "BOARDED" : "TRANSPORTED";

                  return (
                    <tr key={stop.id}>
                      <td>
                        <div className="table-actions">
                          <span>{stop.stopOrder}</span>
                          <form action={moveDriverStopAction}>
                            <input type="hidden" name="runId" value={run.id} />
                            <input type="hidden" name="stopId" value={stop.id} />
                            <input type="hidden" name="direction" value="up" />
                            <button className="ghost-button table-action" type="submit">↑</button>
                          </form>
                          <form action={moveDriverStopAction}>
                            <input type="hidden" name="runId" value={run.id} />
                            <input type="hidden" name="stopId" value={stop.id} />
                            <input type="hidden" name="direction" value="down" />
                            <button className="ghost-button table-action" type="submit">↓</button>
                          </form>
                        </div>
                      </td>
                      <td>
                        {passenger.firstName} {passenger.lastName}
                        {whatsappUrl ? (
                          <>
                            {" "}
                            <a className="table-link" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                              WhatsApp
                            </a>
                          </>
                        ) : null}
                      </td>
                      <td>{stop.pickupName} · {stop.pickupAddress}</td>
                      <td>{stop.passengerCount}</td>
                      <td>{stop.status}</td>
                      <td>
                        <div className="table-actions">
                          <form action={updateDriverStopStatusAction}>
                            <input type="hidden" name="stopId" value={stop.id} />
                            <input type="hidden" name="status" value={positiveStatus} />
                            <button className="button table-action" type="submit">
                              {run.direction === "UP" ? "Subio" : "Transportado"}
                            </button>
                          </form>
                          <form action={updateDriverStopStatusAction}>
                            <input type="hidden" name="stopId" value={stop.id} />
                            <input type="hidden" name="status" value="NO_SHOW" />
                            <button className="ghost-button table-action" type="submit">
                              No aparecio
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
