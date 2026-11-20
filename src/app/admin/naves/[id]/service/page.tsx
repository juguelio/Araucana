import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { checksGuardados, fallasDePlanilla, resumenDePlanilla } from "@/lib/vehicles/service-sheet";
import { CabeceraDeNave, SinDatos, cargarNave, diaUtc, fechaCorta, hrefDeNave, nombreDeNave } from "../ficha-de-nave";
import { createServiceSheetAction } from "../ficha-actions";
import { ServiceSheetForm } from "../ficha-forms";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notice?: string }>;
};

/**
 * Service de una nave: el historial de planillas del taller (fecha, kilometraje, qué se revisó, qué se
 * hizo) y el formulario para cargar la próxima. Reemplaza la planilla de papel que hoy se archiva en
 * la carpeta de la unidad.
 */
export default async function ServiceDeNavePage({ params, searchParams }: Props) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const notice = (await searchParams)?.notice;
  const nave = await cargarNave(id);
  const planillas = await prisma.vehicleServiceSheet.findMany({
    where: { vehicleId: id },
    orderBy: [{ servicedAt: "desc" }, { createdAt: "desc" }]
  });

  const ultima = planillas[0];
  const ultimaChecks = ultima ? checksGuardados(ultima.checks) : {};
  const resumenUltima = resumenDePlanilla(ultimaChecks);
  const fallasUltima = fallasDePlanilla(ultimaChecks);
  // El kilometraje más alto cargado es el mejor dato de «por dónde anda» la unidad.
  const kmMaximo = planillas.reduce((maximo, p) => (p.odometerKm > maximo ? p.odometerKm : maximo), 0);

  return (
    <AdminShell role={sessionUser.role} title={nombreDeNave(nave)} eyebrow="Naves · Service" notice={notice}>
      <CabeceraDeNave nave={nave} seccion="service" />

      <section className="plain-card admin-section" aria-labelledby="service-resumen">
        <div className="nave-seccion-top">
          <h2 id="service-resumen">Historial de service</h2>
          <span className="muted">
            {planillas.length === 0
              ? "sin planillas cargadas"
              : `${planillas.length} planilla${planillas.length === 1 ? "" : "s"} · último ${fechaCorta(ultima.servicedAt)}`}
          </span>
        </div>

        {ultima ? (
          <p className="service-ultimo">
            <strong>{ultima.odometerKm.toLocaleString("es-AR")} km</strong> el {fechaCorta(ultima.servicedAt)}
            {ultima.workDone ? ` · ${ultima.workDone}` : ""}
            {resumenUltima.fallas > 0 ? (
              <>
                {" · "}
                <Link href={`${hrefDeNave(id, "danios")}`}>{resumenUltima.fallas} falla{resumenUltima.fallas === 1 ? "" : "s"} para pasar a daños</Link>
              </>
            ) : null}
          </p>
        ) : null}

        {planillas.length === 0 ? (
          <SinDatos titulo="Esta nave todavía no tiene planillas de service.">
            Cargá la primera con el formulario de abajo: queda el kilometraje, qué se revisó y qué se hizo.
          </SinDatos>
        ) : (
          <div className="table-scroll">
            <table className="data-table nave-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Kilometraje</th>
                  <th>Qué se revisó</th>
                  <th>Qué se hizo</th>
                  <th>Cargó</th>
                </tr>
              </thead>
              <tbody>
                {planillas.map((planilla) => {
                  const checks = checksGuardados(planilla.checks);
                  const resumen = resumenDePlanilla(checks);
                  const fallas = fallasDePlanilla(checks);
                  return (
                    <tr key={planilla.id} data-nivel={resumen.fallas > 0 ? "proximo" : undefined}>
                      <td data-label="Fecha">{diaUtc(planilla.servicedAt)}</td>
                      <td data-label="Kilometraje">{planilla.odometerKm.toLocaleString("es-AR")} km</td>
                      <td data-label="Qué se revisó">
                        {resumen.revisados === 0 ? (
                          <span className="muted">sin ítems marcados</span>
                        ) : (
                          <>
                            {resumen.revisados} ítems
                            {resumen.fallas > 0 ? (
                              <>
                                <br />
                                <span className="muted">
                                  {fallas.map((f) => `${f.seccion}: ${f.label}`).join(" · ")}
                                </span>
                              </>
                            ) : (
                              <br />
                            )}
                            {resumen.fallas === 0 ? <span className="muted">sin fallas</span> : null}
                          </>
                        )}
                      </td>
                      <td data-label="Qué se hizo">
                        {planilla.workDone ?? <span className="muted">—</span>}
                        {planilla.notes ? (
                          <>
                            <br />
                            <span className="muted">{planilla.notes}</span>
                          </>
                        ) : null}
                      </td>
                      <td data-label="Cargó">{planilla.reportedBy ?? <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {kmMaximo > 0 ? <p className="muted nave-nota">Kilometraje más alto registrado: {kmMaximo.toLocaleString("es-AR")} km.</p> : null}
      </section>

      <section className="plain-card admin-section" aria-labelledby="service-nueva">
        <h2 id="service-nueva">Cargar planilla de service</h2>
        <p className="muted nave-nota">
          La misma planilla que se llena en papel: marcá lo que se revisó y anotá qué se le hizo. Lo que quede en «—» no se cuenta como revisado.
        </p>
        <ServiceSheetForm action={createServiceSheetAction} vehicleId={id} />
      </section>
    </AdminShell>
  );
}
