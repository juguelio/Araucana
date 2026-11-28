import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { BarraDelMes, Cifras, SelectorDeVista, type Cifra } from "@/components/modulo/modulo";
import { totalsByCurrency } from "@/lib/accounting/export-rows";
import {
  GASTOS_GENERALES,
  SIN_NAVE,
  conParte,
  periodoAnterior,
  resultadoPorNave,
  rutasQueMasFacturan,
  textoDeVariacion,
  totalesPorMoneda
} from "@/lib/accounting/reporte";
import { createMonthPeriod, createRangePeriod, getAccountingReport } from "@/lib/accounting/service";
import { mesVecino } from "@/lib/accounting/sueldos";
import { formatCurrency } from "@/lib/admin/salary";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { prisma } from "@/lib/db/prisma";
import "./reportes.css";

/**
 * Reportes (rediseño del 26-nov, con las piezas de Contabilidad). Contabilidad es el trabajo del mes;
 * Reportes es mirar un período entero y compararlo:
 *
 * - Mes (con la barra del mes) o Entre fechas; filtro por nave.
 * - Cifras por moneda con la variación contra el período anterior de la misma duración.
 * - Resultado por nave: lo que entró menos lo que se gastó en cada una, más los ingresos sin nave y
 *   los gastos generales, para que los totales cierren con las cifras.
 * - En qué se fue la plata (categorías), los sueldos pagados y las rutas que más facturan.
 * - El Excel sigue igual y descarga lo mismo que se ve.
 */

const BASE = "/admin/reportes";

type ReportsPageProps = {
  searchParams?: Promise<{
    month?: string;
    from?: string;
    to?: string;
    vehicleId?: string;
    vista?: string;
    notice?: string;
  }>;
};

const esMes = (valor?: string) => Boolean(valor && /^\d{4}-\d{2}$/.test(valor));
const esDia = (valor?: string) => Boolean(valor && /^\d{4}-\d{2}-\d{2}$/.test(valor));
const porcentaje = (valor: number | null) => (valor === null ? "—" : `${valor.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`);

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const params = (await searchParams) ?? {};
  const hoy = argentinaDateKey(new Date());
  const mesDeHoy = hoy.slice(0, 7);
  const mes = esMes(params.month) ? params.month! : mesDeHoy;

  // Entre fechas: con las dos fechas válidas; si se eligió la vista sin fechas, arranca con el mes.
  const hayRango = esDia(params.from) && esDia(params.to);
  const vista: "mes" | "rango" = hayRango || params.vista === "rango" ? "rango" : "mes";
  const desde = hayRango ? params.from! : `${mes}-01`;
  const hasta = hayRango ? params.to! : new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const period = hayRango ? createRangePeriod(desde, hasta) : createMonthPeriod(mes);
  const anterior = periodoAnterior(period, !hayRango);
  const vehicleId = params.vehicleId || undefined;

  const [vehicles, report, reportAnterior] = await Promise.all([
    prisma.vehicle.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getAccountingReport({ period, vehicleId }),
    getAccountingReport({ period: anterior, vehicleId })
  ]);
  const nave = vehicleId ? vehicles.find((vehicle) => vehicle.id === vehicleId) : undefined;

  // Los enlaces conservan el período y la nave.
  const consulta = (cambios: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = hayRango ? { from: desde, to: hasta } : { month: mes, vista: vista === "rango" ? "rango" : undefined };
    const query = new URLSearchParams();
    for (const [clave, valor] of Object.entries({ ...base, vehicleId, ...cambios })) if (valor) query.set(clave, valor);
    return query.size ? `${BASE}?${query}` : BASE;
  };
  const hrefMes = (destino: string) => consulta({ month: destino, from: undefined, to: undefined, vista: undefined });

  const exportParams = new URLSearchParams();
  if (hayRango) {
    exportParams.set("from", desde);
    exportParams.set("to", hasta);
  } else {
    exportParams.set("month", mes);
  }
  if (vehicleId) exportParams.set("vehicleId", vehicleId);
  const exportHref = `${BASE}/export?${exportParams}`;

  // Cifras por moneda, cada una con la variación contra el período anterior.
  const totales = totalsByCurrency(report);
  const totalesAntes = totalsByCurrency(reportAnterior);
  const monedas = totales.length ? totales.map((fila) => fila.currency) : ["ARS"];
  const varias = monedas.length > 1;
  const cifrasDe = (moneda: string): Cifra[] => {
    const t = totales.find((fila) => fila.currency === moneda) ?? { incomeCents: 0, expenseCents: 0 };
    const a = totalesAntes.find((fila) => fila.currency === moneda) ?? { incomeCents: 0, expenseCents: 0 };
    const sufijo = varias ? ` (${moneda})` : "";
    const aPesos = (cents: number) => formatCurrency(cents, moneda);
    const resultado = t.incomeCents - t.expenseCents;
    const resultadoAntes = a.incomeCents - a.expenseCents;
    return [
      { rotulo: `Ingresos${sufijo}`, valor: formatCurrency(t.incomeCents, moneda), detalle: textoDeVariacion(t.incomeCents, a.incomeCents, anterior.nombre, aPesos) },
      { rotulo: `Egresos${sufijo}`, valor: formatCurrency(t.expenseCents, moneda), detalle: textoDeVariacion(t.expenseCents, a.expenseCents, anterior.nombre, aPesos) },
      {
        rotulo: `Resultado${sufijo}`,
        valor: formatCurrency(resultado, moneda),
        alerta: resultado < 0,
        detalle: textoDeVariacion(resultado, resultadoAntes, anterior.nombre, aPesos)
      },
      {
        rotulo: `Margen${sufijo}`,
        valor: t.incomeCents ? porcentaje(Math.round((resultado / t.incomeCents) * 1000) / 10) : "—",
        alerta: resultado < 0 && t.incomeCents > 0,
        detalle: "resultado sobre ingresos"
      }
    ];
  };

  const filasDeNave = resultadoPorNave(report);
  const totalesDeNave = totalesPorMoneda(filasDeNave);
  const categorias = conParte(report.expensesByCategory);
  const sueldos = conParte(report.salariesByPerson);
  const rutas = rutasQueMasFacturan(report.incomes);
  const mayorRuta = (moneda: string) => Math.max(1, ...rutas.filter((r) => r.moneda === moneda).map((r) => r.ingresosCents));
  const textoPeriodo = hayRango ? period.label.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3/$2/$1") : period.label;

  const filtroDeNave = (
    <form key={`${vehicleId ?? "todas"}-${desde}-${hasta}`} action={BASE} method="get" className="rep-nave-form">
      {hayRango ? (
        <>
          <input type="hidden" name="from" value={desde} />
          <input type="hidden" name="to" value={hasta} />
        </>
      ) : (
        <>
          <input type="hidden" name="month" value={mes} />
          {vista === "rango" ? <input type="hidden" name="vista" value="rango" /> : null}
        </>
      )}
      <label>
        <span className="sr-only">Nave</span>
        <select name="vehicleId" defaultValue={vehicleId ?? ""} aria-label="Nave">
          <option value="">Todas las naves</option>
          {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
        </select>
      </label>
      <button className="ghost-button" type="submit">Filtrar</button>
    </form>
  );

  return (
    <AdminShell
      role={sessionUser.role}
      title="Reportes"
      eyebrow="Administración"
      notice={params.notice}
      action={<div className="inline-actions">
        <Link className="ghost-button" href={`/admin/contabilidad?month=${hayRango ? desde.slice(0, 7) : mes}`}>Contabilidad del mes</Link>
        <a className="button" href={exportHref} download>Descargar Excel</a>
      </div>}
    >
      <SelectorDeVista
        opciones={[
          { id: "mes", etiqueta: "Por mes", href: consulta({ month: hayRango ? desde.slice(0, 7) : mes, from: undefined, to: undefined, vista: undefined }) },
          { id: "rango", etiqueta: "Entre fechas", href: hayRango ? consulta({}) : consulta({ vista: "rango" }) }
        ]}
        actual={vista}
      />

      {vista === "mes" ? (
        <BarraDelMes
          accion={BASE}
          mes={mes}
          anterior={hrefMes(mesVecino(mes, -1))}
          siguiente={hrefMes(mesVecino(mes, 1))}
          esteMes={mes !== mesDeHoy ? hrefMes(mesDeHoy) : null}
          ocultos={{ vehicleId }}
        >
          {filtroDeNave}
        </BarraDelMes>
      ) : (
        <section className="flights-toolbar modulo-barra">
          <form key={`${desde}-${hasta}`} className="flights-date rep-rango" action={BASE} method="get">
            <label>Desde<input type="date" name="from" defaultValue={desde} required /></label>
            <label>Hasta<input type="date" name="to" defaultValue={hasta} required /></label>
            {vehicleId ? <input type="hidden" name="vehicleId" value={vehicleId} /> : null}
            <button className="button" type="submit">Ver</button>
          </form>
          <div className="modulo-barra-derecha">{filtroDeNave}</div>
        </section>
      )}

      {nave ? (
        <p className="rep-nave-activa">
          Sólo <strong>{nave.name}</strong>: sus reservas y los gastos cargados a esa nave. <Link href={consulta({ vehicleId: undefined })}>Ver todas las naves</Link>
        </p>
      ) : null}

      <div className="rep-cifras">
        {monedas.map((moneda) => (
          <Cifras key={moneda} etiqueta={`${textoPeriodo}${varias ? ` en ${moneda}` : ""}`} cifras={cifrasDe(moneda)} />
        ))}
      </div>

      <p className="muted flights-note rep-nota">
        <strong>{textoPeriodo}</strong>, comparado con {anterior.nombre}. Los ingresos son las reservas confirmadas o con pago
        aprobado, por el total de la reserva: no son caja cobrada.
        {varias ? ` Hay ${monedas.length} monedas (${monedas.join(", ")}): van separadas, nunca sumadas.` : ""}
      </p>

      <section className="plain-card admin-section rep-bloque" aria-labelledby="rep-naves">
        <header className="rep-cabeza">
          <h2 id="rep-naves">Resultado por nave</h2>
          <p className="muted">Lo que entró por sus reservas menos lo que se le cargó de gastos. Tocá una nave para ver sólo esa.</p>
        </header>
        {filasDeNave.length ? (
          <table className="data-table rep-tabla">
            <thead>
              <tr>
                <th scope="col">Nave</th>
                <th scope="col" className="rep-num">Ingresos</th>
                <th scope="col" className="rep-num">Gastos</th>
                <th scope="col" className="rep-num">Resultado</th>
                <th scope="col" className="rep-num">Margen</th>
              </tr>
            </thead>
            <tbody>
              {filasDeNave.map((fila) => {
                const especial = fila.id === SIN_NAVE || fila.id === GASTOS_GENERALES;
                return (
                  <tr key={`${fila.id}-${fila.moneda}`} data-especial={especial || undefined} data-negativo={fila.resultadoCents < 0 || undefined}>
                    <th scope="row" className="rep-c-nave">
                      {especial || fila.id === vehicleId ? fila.nave : <Link href={consulta({ vehicleId: fila.id })}>{fila.nave}</Link>}
                      {varias ? <small> · {fila.moneda}</small> : null}
                    </th>
                    <td data-label="Ingresos" className="rep-num">{fila.ingresosCents ? formatCurrency(fila.ingresosCents, fila.moneda) : <span className="muted">—</span>}</td>
                    <td data-label="Gastos" className="rep-num">{fila.gastosCents ? formatCurrency(fila.gastosCents, fila.moneda) : <span className="muted">—</span>}</td>
                    <td data-label="Resultado" className="rep-num rep-c-resultado"><strong>{formatCurrency(fila.resultadoCents, fila.moneda)}</strong></td>
                    <td data-label="Margen" className="rep-num rep-c-margen">{porcentaje(fila.margen)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {totalesDeNave.map((total) => (
                <tr key={total.moneda} data-negativo={total.resultadoCents < 0 || undefined}>
                  <th scope="row" className="rep-c-nave">Total{varias ? ` ${total.moneda}` : ""}</th>
                  <td data-label="Ingresos" className="rep-num">{formatCurrency(total.ingresosCents, total.moneda)}</td>
                  <td data-label="Gastos" className="rep-num">{formatCurrency(total.gastosCents, total.moneda)}</td>
                  <td data-label="Resultado" className="rep-num rep-c-resultado"><strong>{formatCurrency(total.resultadoCents, total.moneda)}</strong></td>
                  <td data-label="Margen" className="rep-num rep-c-margen">{porcentaje(total.margen)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        ) : (
          <p className="rep-vacio">No hay ingresos ni gastos en {textoPeriodo}.</p>
        )}
      </section>

      <div className="rep-grilla">
        <section className="plain-card admin-section rep-bloque" aria-labelledby="rep-categorias">
          <header className="rep-cabeza"><h2 id="rep-categorias">En qué se fue la plata</h2></header>
          {categorias.length ? (
            <ul className="rep-barras" role="list">
              {categorias.map((grupo) => (
                <li key={`${grupo.id}-${grupo.currency}`}>
                  <span>{grupo.label}{varias ? ` (${grupo.currency})` : ""}</span>
                  <strong>{formatCurrency(grupo.amountCents, grupo.currency)}</strong>
                  <div className="rep-barra" aria-hidden><span style={{ width: `${Math.max(2, grupo.parte)}%` }} /></div>
                  <small>{grupo.parte || grupo.amountCents <= 0 ? `${grupo.parte} %` : "<1 %"}</small>
                </li>
              ))}
            </ul>
          ) : <p className="rep-vacio">Sin egresos cargados.</p>}
        </section>

        <section className="plain-card admin-section rep-bloque" aria-labelledby="rep-sueldos">
          <header className="rep-cabeza">
            <h2 id="rep-sueldos">Sueldos pagados</h2>
            <Link className="rep-ver" href={`/admin/contabilidad?month=${hayRango ? desde.slice(0, 7) : mes}&seccion=sueldos`}>Ver pendientes →</Link>
          </header>
          {sueldos.length ? (
            <ul className="rep-barras" role="list">
              {sueldos.map((grupo) => (
                <li key={`${grupo.id}-${grupo.currency}`}>
                  <span>{grupo.label}{varias ? ` (${grupo.currency})` : ""}</span>
                  <strong>{formatCurrency(grupo.amountCents, grupo.currency)}</strong>
                  <div className="rep-barra" aria-hidden><span style={{ width: `${Math.max(2, grupo.parte)}%` }} /></div>
                  <small>{grupo.parte || grupo.amountCents <= 0 ? `${grupo.parte} %` : "<1 %"}</small>
                </li>
              ))}
            </ul>
          ) : <p className="rep-vacio">Sin sueldos pagados en el período.</p>}
        </section>

        <section className="plain-card admin-section rep-bloque rep-bloque-ancho" aria-labelledby="rep-rutas">
          <header className="rep-cabeza">
            <h2 id="rep-rutas">Rutas que más facturan</h2>
            <Link className="rep-ver" href={`/admin/contabilidad?month=${hayRango ? desde.slice(0, 7) : mes}&seccion=ingresos`}>Ver ingresos →</Link>
          </header>
          {rutas.length ? (
            <ul className="rep-rutas" role="list">
              {rutas.map((ruta) => (
                <li key={`${ruta.ruta}-${ruta.moneda}`}>
                  <span className="rep-rutas-nombre">{ruta.ruta}{varias ? ` (${ruta.moneda})` : ""}</span>
                  <small>{ruta.reservas} {ruta.reservas === 1 ? "reserva" : "reservas"}</small>
                  <div className="rep-barra" aria-hidden><span style={{ width: `${(ruta.ingresosCents / mayorRuta(ruta.moneda)) * 100}%` }} /></div>
                  <strong>{formatCurrency(ruta.ingresosCents, ruta.moneda)}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="rep-vacio">Sin ingresos en el período.</p>}
        </section>
      </div>
    </AdminShell>
  );
}
