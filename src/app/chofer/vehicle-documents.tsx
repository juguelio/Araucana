import { documentosPorTipo, fechaDePapel } from "@/lib/vehicles/documents";

export type DocumentoDeLaNave = {
  id: string;
  kind: string;
  fileName: string;
  createdAt: Date;
  expiresAt: Date | null;
};

/**
 * Los papeles vigentes de la unidad que el chofer tiene asignada. Sólo lectura y sólo los vigentes:
 * el historial de lo reemplazado es cosa de la oficina. Los archivos se sirven por la ruta
 * autenticada, que además comprueba que la unidad sea la del chofer.
 */
export function DriverVehicleDocuments({ vehicleId, vehicleName, documentos }: {
  vehicleId: string;
  vehicleName: string;
  documentos: DocumentoDeLaNave[];
}) {
  const tipos = documentosPorTipo(documentos);

  return (
    <section className="plain-card admin-section" aria-labelledby="chofer-papeles">
      <div className="nave-seccion-top">
        <h2 id="chofer-papeles">Papeles de la unidad</h2>
        <span className="muted">{vehicleName}</span>
      </div>
      <p className="muted">
        La documentación vigente de la nave que tenés asignada. Si un papel falta o está vencido, avisá a la oficina.
      </p>
      <ul className="nave-lista">
        {tipos.map(({ tipo, label, vigente }) => (
          <li key={tipo}>
            <span className="nave-lista-fecha">
              {vigente?.expiresAt ? `vence ${fechaDePapel(vigente.expiresAt)}` : "sin fecha"}
            </span>
            <span>
              <strong>{label}</strong>
              <br />
              {vigente ? (
                <a rel="noopener" href={`/api/vehiculos/${vehicleId}/documentos/${vigente.id}`} target="_blank">
                  Abrir {vigente.fileName.toLowerCase().endsWith(".pdf") ? "PDF" : "archivo"}
                </a>
              ) : (
                <span className="muted">La oficina todavía no lo subió</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
