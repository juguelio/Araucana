import Link from "next/link";
import { formatoHoras, type ResumenChofer } from "@/lib/public-service/workdays";

type DiasTrabajadosProps = {
  mesLabel: string;
  resumen: ResumenChofer[];
};

/**
 * Base para liquidar: días, salidas y horas de cada chofer en el mes elegido.
 * Es sólo servicio público; no calcula valor de hora ni descuentos.
 */
export function DiasTrabajados({ mesLabel, resumen }: DiasTrabajadosProps) {
  return (
    <details className="plain-card cont-dias" open>
      <summary>
        <span className="cont-dias-titulo">Días trabajados de {mesLabel}</span>
        <span className="cont-dias-meta">
          <small>Base para liquidación · sólo servicio público</small>
          <span className="cont-dias-estado">
            {resumen.length ? `${resumen.length} ${resumen.length === 1 ? "chofer" : "choferes"}` : "Sin datos"}
          </span>
          <span className="cont-dias-chevron" aria-hidden="true">⌄</span>
        </span>
      </summary>
      {resumen.length ? (
        <div className="cont-dias-tabla">
          <table className="data-table">
            <thead>
              <tr>
                <th>Chofer</th>
                <th>Días</th>
                <th>Salidas</th>
                <th>Horas</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((chofer) => (
                <tr key={chofer.driverId}>
                  <td data-label="Chofer">
                    <Link href={`/admin/choferes/${chofer.driverId}`}>{chofer.driverName}</Link>
                  </td>
                  <td data-label="Días"><strong>{chofer.dias.length}</strong></td>
                  <td data-label="Salidas">{chofer.salidas}</td>
                  <td data-label="Horas">{formatoHoras(chofer.horas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="cont-dias-vacio">Todavía no hay días con chofer asignado en {mesLabel}.</p>
      )}
    </details>
  );
}
