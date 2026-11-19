import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { formatCurrency } from "@/lib/admin/salary";
import { ESTADO_DANIO_LABEL, GRAVEDAD_LABEL, resumenDeDanios, type EstadoDeDanio, type Gravedad } from "@/lib/vehicles/ficha";
import { CabeceraDeNave, SinDatos, cargarNave, fechaCorta, hrefDeNave, nombreDeNave } from "../ficha-de-nave";
import { createDamageAction, setDamageStatusAction } from "../ficha-actions";
import { DamageForm } from "../ficha-forms";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notice?: string }>;
};

const TONO_GRAVEDAD: Record<Gravedad, string> = { LEVE: "normal", MODERADO: "atencion", GRAVE: "atencion" };
const TONO_ESTADO: Record<EstadoDeDanio, string> = { PENDIENTE: "atencion", EN_REPARACION: "curso", REPARADO: "ok" };

/** Daños de la nave: se anotan acá, pasan a «en reparación» y se cierran con un arreglo. */
export default async function DaniosDeNavePage({ params, searchParams }: Props) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const notice = (await searchParams)?.notice;
  const nave = await cargarNave(id);
  const danios = await prisma.vehicleDamage.findMany({
    where: { vehicleId: id },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    include: { repairEntry: { select: { amountCents: true, currency: true } } }
  });
  const resumen = resumenDeDanios(danios);
  // Abiertos primero (de más nuevo a más viejo), después los reparados.
  const ordenados = [...danios.filter((d) => d.status !== "REPARADO"), ...danios.filter((d) => d.status === "REPARADO")];

  return (
    <AdminShell role={sessionUser.role} title={nombreDeNave(nave)} eyebrow="Naves · Daños" notice={notice}>
      <CabeceraDeNave nave={nave} seccion="danios" />

      {resumen.graves > 0 ? (
        <p className="form-alert error" role="status">
          Tiene {resumen.graves} daño{resumen.graves === 1 ? "" : "s"} grave{resumen.graves === 1 ? "" : "s"} sin reparar: revisá antes de asignarla a un servicio.
        </p>
      ) : null}

      <section className="plain-card admin-section" aria-labelledby="danios-lista">
        <div className="nave-seccion-top">
          <h2 id="danios-lista">Daños registrados</h2>
          <span className="muted">
            {resumen.abiertos} abierto{resumen.abiertos === 1 ? "" : "s"} · {resumen.total} en total
          </span>
        </div>
        {ordenados.length === 0 ? (
          <SinDatos titulo="Esta nave no tiene daños anotados." >Usá el formulario de abajo para anotar el primero.</SinDatos>
        ) : (
          <div className="table-scroll">
            <table className="data-table nave-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Daño</th>
                  <th>Gravedad</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {ordenados.map((d) => {
                  const estado = d.status as EstadoDeDanio;
                  const gravedad = d.severity as Gravedad;
                  return (
                    <tr key={d.id} data-nivel={estado === "REPARADO" ? undefined : gravedad === "GRAVE" ? "vencido" : "proximo"}>
                      <td data-label="Fecha">{fechaCorta(d.occurredAt)}</td>
                      <td data-label="Daño">
                        {d.description}
                        {d.reportedBy || d.notes ? (
                          <>
                            <br />
                            <span className="muted">{[d.reportedBy ? `Informó: ${d.reportedBy}` : null, d.notes].filter(Boolean).join(" · ")}</span>
                          </>
                        ) : null}
                      </td>
                      <td data-label="Gravedad">
                        <span className="pill pill-estado" data-tono={TONO_GRAVEDAD[gravedad] ?? "normal"}>{GRAVEDAD_LABEL[gravedad] ?? d.severity}</span>
                      </td>
                      <td data-label="Estado">
                        <span className="pill pill-estado" data-tono={TONO_ESTADO[estado] ?? "normal"}>{ESTADO_DANIO_LABEL[estado] ?? d.status}</span>
                        {d.repairedAt ? (
                          <>
                            <br />
                            <span className="muted">
                              {fechaCorta(d.repairedAt)}
                              {d.repairEntry ? ` · ${formatCurrency(d.repairEntry.amountCents, d.repairEntry.currency)}` : ""}
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td data-label="Acciones">
                        <div className="table-actions">
                          {estado === "PENDIENTE" ? (
                            <form action={setDamageStatusAction}>
                              <input type="hidden" name="damageId" value={d.id} />
                              <input type="hidden" name="status" value="EN_REPARACION" />
                              <button className="ghost-button" type="submit">En reparación</button>
                            </form>
                          ) : null}
                          {estado !== "REPARADO" ? (
                            <Link className="ghost-button" href={`${hrefDeNave(id, "reparaciones")}?danio=${d.id}#nuevo-arreglo`}>
                              Registrar arreglo
                            </Link>
                          ) : null}
                          {estado !== "REPARADO" ? (
                            <form action={setDamageStatusAction}>
                              <input type="hidden" name="damageId" value={d.id} />
                              <input type="hidden" name="status" value="REPARADO" />
                              <button className="ghost-button" type="submit">Reparado sin costo</button>
                            </form>
                          ) : (
                            <form action={setDamageStatusAction}>
                              <input type="hidden" name="damageId" value={d.id} />
                              <input type="hidden" name="status" value="PENDIENTE" />
                              <button className="ghost-button" type="submit">Reabrir</button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="plain-card admin-section" aria-labelledby="danios-nuevo">
        <h2 id="danios-nuevo">Anotar un daño</h2>
        <DamageForm action={createDamageAction} vehicleId={id} />
      </section>
    </AdminShell>
  );
}
