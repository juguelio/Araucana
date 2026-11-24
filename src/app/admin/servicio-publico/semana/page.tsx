import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { ServicePublicNav } from "@/components/service-public-nav";
import { ServicioPublicoVistaNav } from "@/components/servicio-publico-vista-nav";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { roleCanAccess } from "@/lib/auth/roles";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { listAdminSchedules } from "@/lib/booking/repository";
import { agruparPorTerminal, estadoLabel, resumenDeSalidas, salidasDeTerminal, terminalDe, TERMINALES, type TerminalClave } from "@/lib/public-service/board";
import { diasDeSemana, etiquetaDeSemana, leerSemana, lunesDe, sumarDias } from "@/lib/school-runs/week";
import "../servicio-publico.css";

export const metadata = { title: "Servicio público · Semana · La Araucana" };
export const dynamic = "force-dynamic";

const diaCorto = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const mesCorto = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });

function esTerminal(valor?: string): valor is TerminalClave {
  return TERMINALES.some((terminal) => terminal.clave === valor);
}

function fechaDe(dia: string) {
  return new Date(`${dia}T12:00:00.000Z`);
}

export default async function ServicioPublicoSemanaPage({ searchParams }: {
  searchParams: Promise<{ semana?: string; terminal?: string }>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const hoy = argentinaDateKey();
  const filtro = esTerminal(params.terminal) ? params.terminal : null;
  const semana = lunesDe(leerSemana(params.semana) ?? hoy);
  const dias = diasDeSemana(semana);
  const filasPorDia = await Promise.all(dias.map((dia) => listAdminSchedules({ date: dia, activeRoutesOnly: true })));
  const salidasPorDia = filasPorDia.map((filas) => salidasDeTerminal(filas));
  const salidasSemana = salidasPorDia.flat();
  const visibles = filtro ? salidasSemana.filter((salida) => terminalDe(salida.desde) === filtro) : salidasSemana;
  const resumen = resumenDeSalidas(visibles);
  const cuentaPorTerminal = new Map<TerminalClave, number>(TERMINALES.map((terminal) => [terminal.clave, 0]));
  for (const salida of salidasSemana) {
    const clave = terminalDe(salida.desde);
    if (clave) cuentaPorTerminal.set(clave, (cuentaPorTerminal.get(clave) ?? 0) + 1);
  }
  const hrefSemana = (inicio: string, terminal: TerminalClave | null = filtro) => {
    const query = new URLSearchParams();
    query.set("semana", inicio);
    if (terminal) query.set("terminal", terminal);
    return `/admin/servicio-publico/semana?${query.toString()}`;
  };
  const hrefDia = (dia: string) => {
    const query = new URLSearchParams({ fecha: dia });
    if (filtro) query.set("terminal", filtro);
    return `/admin/servicio-publico?${query.toString()}`;
  };

  return (
    <AdminShell
      title="Servicio público"
      eyebrow="Semana"
      role={user.role}
      action={
        <div className="form-actions">
          <Link className="ghost-button" href="/admin/salidas-del-dia">Salidas del día</Link>
          <Link className="button" href="/admin/reservas/nueva">Vender pasaje</Link>
        </div>
      }
    >
      <ServicePublicNav actual="boleteria" mostrarRutas={roleCanAccess(user.role, ["ADMIN"])} />
      <ServicioPublicoVistaNav actual="semana" fecha={semana} semana={semana} terminal={filtro} />

      <div className="sp-semana-nav">
        <Link className="ghost-button" href={hrefSemana(sumarDias(semana, -7))}>‹ Semana anterior</Link>
        <strong>{etiquetaDeSemana(semana)}</strong>
        <Link className="ghost-button" href={hrefSemana(sumarDias(semana, 7))}>Semana siguiente ›</Link>
        {semana !== lunesDe(hoy) ? <Link className="ghost-button" href={hrefSemana(lunesDe(hoy))}>Esta semana</Link> : null}
        <span className="muted">{resumen.salidas} {resumen.salidas === 1 ? "salida" : "salidas"}</span>
      </div>

      <nav className="sp-terminales" aria-label="Terminal">
        <Link className="sp-terminal" data-activa={!filtro ? "si" : undefined} href={hrefSemana(semana, null)}>
          <span>Todas las terminales</span>
          <strong>{salidasSemana.length}</strong>
        </Link>
        {TERMINALES.map((terminal) => (
          <Link
            key={terminal.clave}
            className="sp-terminal"
            data-activa={filtro === terminal.clave ? "si" : undefined}
            href={hrefSemana(semana, terminal.clave)}
          >
            <span>{terminal.nombre}</span>
            <strong>{cuentaPorTerminal.get(terminal.clave) ?? 0}</strong>
          </Link>
        ))}
      </nav>

      <section className="sp-resumen" aria-label="Resumen de la semana">
        <div><span>Salidas</span><strong>{resumen.salidas}</strong></div>
        <div><span>Pasajeros anotados</span><strong>{resumen.pasajeros}</strong></div>
        <div><span>Lugares libres</span><strong>{resumen.libres}</strong></div>
      </section>

      <section className="sp-semana" aria-label={`Semana del ${etiquetaDeSemana(semana)}`}>
        <div className="sp-semana-scroll">
          <div className="sp-semana-grid">
            {dias.map((dia, indice) => {
              const delDia = filtro
                ? salidasPorDia[indice].filter((salida) => terminalDe(salida.desde) === filtro)
                : salidasPorDia[indice];
              const fecha = fechaDe(dia);
              const grupos = agruparPorTerminal(delDia, filasPorDia[indice]);
              return (
                <article key={dia} className="sp-semana-dia" data-hoy={dia === hoy}>
                  <header>
                    <span>{diaCorto.format(fecha)}</span>
                    <strong>{fecha.getUTCDate()}</strong>
                    <small>{mesCorto.format(fecha)}</small>
                  </header>
                  <p className="muted">{delDia.length ? `${delDia.length} ${delDia.length === 1 ? "salida" : "salidas"}` : "Sin salidas"}</p>
                  <div className="sp-semana-lista">
                    {delDia.map((salida) => {
                      const grupo = grupos.find((item) => item.clave === terminalDe(salida.desde));
                      return (
                        <Link key={salida.id} className="sp-semana-card" href={hrefDia(dia)} title={`${salida.recorrido} · ${salida.hora}`}>
                          <span className="sp-semana-terminal">{grupo?.corto ?? "—"} · {salida.hora}</span>
                          <strong>{salida.recorrido}</strong>
                          <span>{salida.nave}{salida.driverName ? ` · ${salida.driverName}` : " · Sin chofer"}</span>
                          <span>{salida.ocupados} de {salida.capacidad} ocupados</span>
                          <span className="sp-estado" data-estado={salida.estado}>{estadoLabel(salida.estado)}</span>
                        </Link>
                      );
                    })}
                  </div>
                  {delDia.length === 0 ? <p className="sp-vacio">Sin salidas.</p> : null}
                  <Link className="sp-semana-ver" href={hrefDia(dia)}>Ver el día →</Link>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
