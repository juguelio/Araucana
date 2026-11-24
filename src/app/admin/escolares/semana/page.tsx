import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { ConcesionesNav } from "@/components/concesiones-nav";
import { BarraDeSemana, ChipsDeFiltro, ROTULO_DE_SERVICIOS, SelectorDeVista, vistasDeModulo } from "@/components/modulo/modulo";
import { WeeklyCalendar } from "@/components/weekly-calendar/weekly-calendar";
import { calendarWeekStart } from "@/lib/admin/weekly-calendar";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { leerTurno } from "@/lib/school-runs/dia";
import { leerTipoDeConcesion } from "@/lib/school-runs/kinds";
import { diasDeSemana, etiquetaDeSemana, lunesDe, sumarDias } from "@/lib/school-runs/week";
import { dateOnly, localInput } from "@/lib/special-trips/data";
import { loadConcesionesWeek } from "./data";
import "../escolares.css";

const diaCorto = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const mesCorto = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });

function fechaDe(dia: string) {
  return new Date(`${dia}T12:00:00.000Z`);
}

/**
 * Concesiones · Semana, con el patrón común de los módulos de servicios (24-nov): el mismo
 * calendario que Servicio público y Viajes especiales (`WeeklyCalendar`), el selector Semana · Día
 * y, sólo acá, la vista «por chofer» (una fila por persona y una columna por día).
 */
export default async function WeekPage({ searchParams }: {
  searchParams: Promise<{ semana?: string; tipo?: string; vista?: string; aviso?: string }>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const tipo = leerTipoDeConcesion(params.tipo);
  const porChofer = params.vista === "chofer";
  const hoy = dateOnly(localInput(new Date()).slice(0, 10))!.toISOString().slice(0, 10);
  const semana = calendarWeekStart(params.semana) ?? lunesDe(hoy);
  const dias = diasDeSemana(semana);
  const conTipo = (query: URLSearchParams) => {
    if (tipo) query.set("tipo", tipo);
    return query;
  };
  const hrefSemana = (inicio: string, chofer = porChofer) =>
    `/admin/escolares/semana?${conTipo(new URLSearchParams({ semana: inicio, ...(chofer ? { vista: "chofer" } : {}) }))}`;
  const diaDeLaSemana = hoy >= dias[0] && hoy <= dias[6] ? hoy : semana;
  const hrefDia = (fecha: string, kind?: string) => `/admin/escolares?fecha=${fecha}${kind ? `&tipo=${kind}` : tipo ? `&tipo=${tipo}` : ""}`;

  const consultaPorChofer = () => prisma.schoolRun.findMany({
    where: { serviceDate: { gte: new Date(`${dias[0]}T00:00:00.000Z`), lte: new Date(`${dias[6]}T00:00:00.000Z`) }, ...(tipo ? { kind: tipo } : {}) },
    orderBy: [{ serviceDate: "asc" }, { shift: "asc" }, { routeName: "asc" }],
    include: { driver: { select: { name: true, email: true } }, vehicle: { select: { name: true } } }
  });
  const [initial, runs] = await Promise.all([
    porChofer ? null : loadConcesionesWeek(semana, tipo),
    porChofer ? consultaPorChofer() : ([] as Awaited<ReturnType<typeof consultaPorChofer>>)
  ]);

  const porPersona = new Map<string, { nombre: string; dias: Map<string, typeof runs> }>();
  for (const run of runs) {
    const dia = run.serviceDate.toISOString().slice(0, 10);
    const clave = run.driverId ?? "sin-chofer";
    const fila = porPersona.get(clave) ?? { nombre: run.driver?.name ?? run.driver?.email ?? "Sin chofer", dias: new Map(dias.map((d) => [d, [] as typeof runs])) };
    fila.dias.get(dia)?.push(run);
    porPersona.set(clave, fila);
  }
  const choferes = [...porPersona.entries()]
    .map(([clave, fila]) => ({ clave, ...fila, total: [...fila.dias.values()].reduce((n, delDia) => n + delDia.length, 0) }))
    .sort((a, b) => Number(a.clave !== "sin-chofer") - Number(b.clave !== "sin-chofer") || a.nombre.localeCompare(b.nombre, "es"));

  const agrupar = (
    <ChipsDeFiltro
      etiqueta="Agrupar"
      actual={porChofer ? "chofer" : "dia"}
      filtros={[
        { id: "dia", etiqueta: "Por día", href: hrefSemana(semana, false) },
        { id: "chofer", etiqueta: "Por chofer", href: hrefSemana(semana, true) }
      ]}
    />
  );

  return (
    <AdminShell title="Concesiones" eyebrow={ROTULO_DE_SERVICIOS} role={user.role} notice={params.aviso}
      action={<div className="inline-actions">
        <Link className="ghost-button" href="/admin/escolares/importar">Importar</Link>
        <Link className="button" href={`/admin/escolares/nuevo?fecha=${diaDeLaSemana}${tipo ? `&tipo=${tipo}` : ""}`}>Nuevo servicio</Link>
      </div>}>
      <ConcesionesNav actual={tipo ?? "todos"} semana={semana} />
      <SelectorDeVista actual="semana" opciones={vistasDeModulo(hrefSemana(semana), hrefDia(diaDeLaSemana))} />
      {porChofer ? (
        <>
          <BarraDeSemana
            accion="/admin/escolares/semana"
            lunes={semana}
            rango={etiquetaDeSemana(semana)}
            anterior={hrefSemana(sumarDias(semana, -7))}
            siguiente={hrefSemana(sumarDias(semana, 7))}
            estaSemana={semana !== lunesDe(hoy) ? hrefSemana(lunesDe(hoy)) : null}
            ocultos={{ tipo, vista: "chofer" }}
          >
            {agrupar}
          </BarraDeSemana>
          <section className="cn-choferes" aria-label={`Semana por chofer del ${etiquetaDeSemana(semana)}`}>
            <div className="cn-choferes-scroll">
              <table className="cn-choferes-tabla">
                <thead>
                  <tr>
                    <th>Chofer</th>
                    {dias.map((dia) => {
                      const fecha = fechaDe(dia);
                      return <th key={dia} data-hoy={dia === hoy || undefined}><span>{diaCorto.format(fecha)}</span><strong>{fecha.getUTCDate()}</strong><small>{mesCorto.format(fecha)}</small></th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {choferes.length === 0 ? (
                    <tr><td colSpan={8} className="cn-choferes-vacio">No hay servicios esta semana.</td></tr>
                  ) : choferes.map((chofer) => (
                    <tr key={chofer.clave}>
                      <th scope="row"><strong>{chofer.nombre}</strong><small>{chofer.total} {chofer.total === 1 ? "servicio" : "servicios"}</small></th>
                      {dias.map((dia) => (
                        <td key={dia} data-hoy={dia === hoy || undefined}>
                          {(chofer.dias.get(dia) ?? []).sort((a, b) => leerTurno(a.shift).orden - leerTurno(b.shift).orden).map((run) => (
                            <Link key={run.id} className="cn-chofer-servicio" href={`${hrefDia(dia, run.kind)}#servicio-${run.id}`}>
                              <strong>{run.routeName}</strong>
                              <span>{leerTurno(run.shift).etiqueta} · {run.vehicle?.name ?? "Sin nave"}</span>
                            </Link>
                          ))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="modulo-barra-derecha cn-agrupar">{agrupar}</div>
          <WeeklyCalendar key={`${semana}:${tipo ?? ""}`} start={semana} today={hoy} initial={initial!}
            dataUrl={`/admin/escolares/semana/datos${tipo ? `?tipo=${tipo}` : ""}`}
            label="Calendario de Concesiones" singular="servicio" plural="servicios" empty="Sin servicios" />
        </>
      )}
    </AdminShell>
  );
}
