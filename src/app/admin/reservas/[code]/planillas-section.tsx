import Link from "next/link";
import { ensureDepartureSheetAction, setDepartureSheetOpenAction } from "@/app/admin/planillas/actions";
import { PlanillaLinkBox } from "@/app/admin/planillas/[id]/link-box";
import { departureSheetCopy, departureSheetKinds } from "@/lib/departure-sheets/types";
import "@/app/admin/planillas/planillas.css";

type SheetRow = {
  id: string;
  kind: string;
  token: string;
  isOpen: boolean;
  _count: { passengers: number };
};

/**
 * Planillas que se le mandan al pasajero de esta reserva. El operador genera el link una vez y lo
 * comparte; el pasajero completa los datos que piden Migraciones (DUT) o la provincia.
 */
export function PlanillasSection({ code, sheets }: { code: string; sheets: SheetRow[] }) {
  return (
    <section className="plain-card admin-section" id="planillas">
      <h2>Planillas de salida</h2>
      <p className="muted">
        El link es de esta reserva: se lo mandás al pasajero y él completa los datos. El DUT va para
        salir del país; el registro de salida, para salir de la provincia.
      </p>

      {departureSheetKinds.map((kind) => {
        const copy = departureSheetCopy[kind];
        const sheet = sheets.find((item) => item.kind === kind);

        return (
          <div className="planilla-fila" key={kind}>
            <div className="planilla-fila-titulo">
              <strong>{copy.shortLabel}</strong>
              <span className="muted">
                {sheet
                  ? `${sheet._count.passengers} ${sheet._count.passengers === 1 ? "pasajero cargado" : "pasajeros cargados"} · ${sheet.isOpen ? "recibiendo datos" : "cerrada"}`
                  : "Todavía sin link"}
              </span>
            </div>

            {sheet ? (
              <div className="planilla-fila-cuerpo">
                <PlanillaLinkBox token={sheet.token} title={`Reserva ${code} · ${copy.shortLabel}`} />
                <div className="inline-actions">
                  <Link className="ghost-button" href={`/admin/planillas/${sheet.id}`}>
                    Ver planilla y descargar
                  </Link>
                  <form action={setDepartureSheetOpenAction}>
                    <input type="hidden" name="id" value={sheet.id} />
                    <input type="hidden" name="code" value={code} />
                    <input type="hidden" name="isOpen" value={sheet.isOpen ? "0" : "1"} />
                    <button className="ghost-button" type="submit">
                      {sheet.isOpen ? "Cerrar el link" : "Reabrir el link"}
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <form action={ensureDepartureSheetAction} className="inline-actions">
                <input type="hidden" name="code" value={code} />
                <input type="hidden" name="kind" value={kind} />
                <button className="button" type="submit">Generar link</button>
              </form>
            )}
          </div>
        );
      })}
    </section>
  );
}
