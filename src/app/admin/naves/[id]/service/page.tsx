import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import {
  SECCIONES_DE_SERVICE, checksGuardados, fallasDePlanilla, fallasQueSeRepiten, notasGuardadas, resumenDePlanilla, type EstadoDeItem
} from "@/lib/vehicles/service-sheet";
import { CabeceraDeNave, SinDatos, cargarNave, diaUtc, hrefDeNave, nombreDeNave } from "../ficha-de-nave";
import { createServiceSheetAction } from "../ficha-actions";
import { ServiceCardForm, type UltimoService } from "../service-form";
import "./service.css";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notice?: string }>;
};

const ICONO: Record<EstadoDeItem | "vacio", string> = { OK: "✓", FALLA: "✕", NA: "–", vacio: "·" };
const km = (n: number) => `${n.toLocaleString("es-AR")} km`;

/** «hoy», «hace 23 días», «hace 3 meses»: cuánto pasó desde un día guardado a las 00:00Z. */
function haceCuanto(dia: Date, hoyClave: string) {
  const dias = Math.round((+new Date(`${hoyClave}T00:00:00Z`) - +dia) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 60) return `hace ${dias} días`;
  return `hace ${Math.round(dias / 30)} meses`;
}

/**
 * Service de una nave: arriba, cómo quedó el último (lo pendiente y lo que se repite); después, la
 * tarjeta para cargar la planilla nueva; abajo, el historial con cada planilla completa. Reemplaza la
 * planilla de papel que hoy se archiva en la carpeta de la unidad.
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
  const hoyClave = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Salta" }).format(new Date());

  const ultima = planillas[0];
  const ultimaChecks = ultima ? checksGuardados(ultima.checks) : {};
  const ultimaNotas = ultima ? notasGuardadas(ultima.checks) : {};
  const pendientes = fallasDePlanilla(ultimaChecks);
  const repetidas = fallasQueSeRepiten(planillas);
  const ultimo: UltimoService = ultima ? {
    fecha: ultima.servicedAt.toISOString().slice(0, 10),
    fechaLabel: diaUtc(ultima.servicedAt),
    km: planillas.reduce((max, p) => Math.max(max, p.odometerKm), 0),
    fallas: Object.fromEntries(pendientes.map((f) => [f.id, ultimaNotas[f.id] ?? true]))
  } : null;

  return (
    <AdminShell role={sessionUser.role} title={nombreDeNave(nave)} eyebrow="Naves · Service" notice={notice}>
      <CabeceraDeNave nave={nave} seccion="service" />

      {ultima ? (
        <section className="plain-card admin-section svc-estado" aria-labelledby="svc-estado-titulo">
          <div className="svc-estado-dato">
            <span className="svc-etiqueta">Último service</span>
            <strong id="svc-estado-titulo">{diaUtc(ultima.servicedAt)}</strong>
            <span className="muted">{haceCuanto(ultima.servicedAt, hoyClave)}</span>
          </div>
          <div className="svc-estado-dato">
            <span className="svc-etiqueta">Kilometraje</span>
            <strong>{km(ultima.odometerKm)}</strong>
            {planillas[1] ? <span className="muted">+{km(ultima.odometerKm - planillas[1].odometerKm)} desde el anterior</span> : <span className="muted">primer registro</span>}
          </div>
          <div className="svc-estado-dato svc-estado-pendiente" data-alerta={pendientes.length > 0 || undefined}>
            <span className="svc-etiqueta">Quedó pendiente</span>
            {pendientes.length ? (
              <ul>{pendientes.map((f) => <li key={f.id}><strong>{f.seccion}: {f.label}</strong>{ultimaNotas[f.id] ? <span className="muted"> · {ultimaNotas[f.id]}</span> : null}</li>)}</ul>
            ) : <strong>Nada: sin fallas</strong>}
            {pendientes.length ? <Link className="table-link" href={hrefDeNave(id, "danios")}>Pasar a daños</Link> : null}
          </div>
          {repetidas.length ? (
            <div className="svc-estado-dato svc-estado-repite" data-alerta="true">
              <span className="svc-etiqueta">Se repite</span>
              <ul>{repetidas.map((f) => <li key={f.id}><strong>{f.seccion}: {f.label}</strong> <span className="muted">· falló en {f.veces} de los últimos {f.de} services</span></li>)}</ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="plain-card admin-section" aria-labelledby="service-nueva">
        <h2 id="service-nueva">Cargar planilla de service</h2>
        <ServiceCardForm action={createServiceSheetAction} vehicleId={id} ultimo={ultimo}
          nave={[nombreDeNave(nave), nave.licensePlate].filter(Boolean).join(" · ")} imprimirHref={`${hrefDeNave(id, "service")}/imprimir`} />
      </section>

      <section className="plain-card admin-section" aria-labelledby="service-historial">
        <div className="nave-seccion-top">
          <h2 id="service-historial">Historial</h2>
          <span className="muted">{planillas.length ? `${planillas.length} planilla${planillas.length === 1 ? "" : "s"}` : "sin planillas"}</span>
        </div>
        {planillas.length === 0 ? (
          <SinDatos titulo="Esta nave todavía no tiene planillas de service.">
            Cargá la primera con la tarjeta de arriba: queda el kilometraje, qué se revisó y qué se hizo.
          </SinDatos>
        ) : (
          <ol className="svc-historial">
            {planillas.map((planilla, index) => {
              const checks = checksGuardados(planilla.checks);
              const notas = notasGuardadas(planilla.checks);
              const resumen = resumenDePlanilla(checks);
              const fallas = fallasDePlanilla(checks);
              const anterior = planillas[index + 1];
              return (
                <li key={planilla.id} className="svc-registro" data-falla={resumen.fallas > 0 || undefined}>
                  <div className="svc-registro-top">
                    <div>
                      <strong>{diaUtc(planilla.servicedAt)}</strong>
                      <span className="muted"> · {haceCuanto(planilla.servicedAt, hoyClave)}</span>
                    </div>
                    <div className="svc-registro-km">
                      <strong>{km(planilla.odometerKm)}</strong>
                      {anterior ? <span className="muted"> · +{km(planilla.odometerKm - anterior.odometerKm)}</span> : null}
                    </div>
                  </div>
                  {planilla.workDone ? <p className="svc-registro-hecho">{planilla.workDone}</p> : <p className="muted svc-registro-hecho">Sin trabajo anotado.</p>}
                  {fallas.length ? (
                    <ul className="svc-chips">{fallas.map((f) => (
                      <li key={f.id} className="pill pill-alerta">{f.seccion}: {f.label}{notas[f.id] ? ` · ${notas[f.id]}` : ""}</li>
                    ))}</ul>
                  ) : null}
                  {planilla.notes ? <p className="muted svc-registro-obs">{planilla.notes}</p> : null}
                  <details className="svc-detalle">
                    <summary>
                      Planilla completa · {resumen.revisados} de {resumen.revisados + resumen.sinRevisar} revisados
                      {resumen.fallas ? ` · ${resumen.fallas} falla${resumen.fallas === 1 ? "" : "s"}` : " · sin fallas"}
                      {planilla.reportedBy ? ` · cargó ${planilla.reportedBy}` : ""}
                    </summary>
                    <div className="svc-detalle-bloques">
                      {SECCIONES_DE_SERVICE.map((seccion) => (
                        <div key={seccion.id} className="svc-detalle-bloque">
                          <strong>{seccion.label}</strong>
                          <ul>{seccion.items.map((item) => {
                            const estado = checks[item.id];
                            return <li key={item.id} data-estado={estado ?? "vacio"}>
                              <span aria-hidden="true">{ICONO[estado ?? "vacio"]}</span> {item.label}
                              <span className="sr-only"> — {estado === "OK" ? "bien" : estado === "FALLA" ? "falla" : estado === "NA" ? "no aplica" : "sin revisar"}</span>
                            </li>;
                          })}</ul>
                        </div>
                      ))}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </AdminShell>
  );
}
