import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { documentosPorTipo, fechaDePapel, tipoCorto } from "@/lib/vehicles/documents";
import { CabeceraDeNave, SinDatos, cargarNave, fechaHora, hrefDeNave, nombreDeNave } from "../ficha-de-nave";
import { DocumentoForm } from "./documento-form";
import { uploadVehicleDocumentAction } from "./actions";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notice?: string }>;
};

/**
 * Los papeles de la unidad como archivos: póliza, técnica, RTO y cédula. Cada tipo muestra el
 * vigente (lo último que se subió) y debajo el historial de lo reemplazado. El chofer ve estos
 * mismos archivos desde su pantalla, sólo lectura.
 */
export default async function DocumentacionDeNavePage({ params, searchParams }: Props) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const notice = (await searchParams)?.notice;
  const nave = await cargarNave(id);
  const documentos = await prisma.vehicleDocument.findMany({
    where: { vehicleId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, fileName: true, createdAt: true, expiresAt: true, uploadedByName: true }
  });
  const tipos = documentosPorTipo(documentos);
  const conPapel = tipos.filter((t) => t.vigente).length;

  return (
    <AdminShell role={sessionUser.role} title={nombreDeNave(nave)} eyebrow="Naves · Documentación" notice={notice}>
      <CabeceraDeNave nave={nave} seccion="documentacion" />

      <p className="muted nave-nota">
        {conPapel} de {tipos.length} papeles adjuntos. El vigente de cada tipo es el último archivo que se sube:
        al reemplazarlo, el anterior queda en el historial de abajo. Las fechas de vencimiento que usa el
        aviso de la flota se cargan en <Link href={hrefDeNave(id, "vencimientos")}>Vencimientos y seguro</Link>.
      </p>

      <section className="nave-panel" aria-label="Documentación de la unidad">
        {tipos.map(({ tipo, label, vigente, historial }) => (
          <div key={tipo} className="plain-card admin-section" aria-labelledby={`doc-${tipo}`}>
            <div className="nave-seccion-top">
              <h2 id={`doc-${tipo}`}>{tipoCorto(tipo)}</h2>
              {vigente ? (
                <a className="ghost-button" href={`/api/vehiculos/${id}/documentos/${vigente.id}`} target="_blank" rel="noreferrer">
                  Abrir {vigente.fileName.toLowerCase().endsWith(".pdf") ? "PDF" : "archivo"}
                </a>
              ) : null}
            </div>

            {vigente ? (
              <p className="muted">
                {vigente.fileName} · subido el {fechaHora(vigente.createdAt)}
                {vigente.uploadedByName ? ` por ${vigente.uploadedByName}` : ""}
                {vigente.expiresAt ? ` · vence ${fechaDePapel(vigente.expiresAt)}` : ""}
              </p>
            ) : (
              <SinDatos titulo={`${label}: sin adjuntar.`}>Subí el PDF o la foto del papel vigente.</SinDatos>
            )}

            <DocumentoForm action={uploadVehicleDocumentAction} vehicleId={id} kind={tipo} etiqueta={label} />

            {historial.length > 0 ? (
              <details className="documento-historial">
                <summary>Historial ({historial.length})</summary>
                <ul className="nave-lista">
                  {historial.map((documento) => (
                    <li key={documento.id}>
                      <span className="nave-lista-fecha">{fechaHora(documento.createdAt)}</span>
                      <span>
                        <a href={`/api/vehiculos/${id}/documentos/${documento.id}`} target="_blank" rel="noreferrer">
                          {documento.fileName}
                        </a>
                        {documento.expiresAt ? <span className="muted"> · vencía {fechaDePapel(documento.expiresAt)}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ))}
      </section>
    </AdminShell>
  );
}
