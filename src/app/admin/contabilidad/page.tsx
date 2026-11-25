import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { EncabezadoOrdenable } from "@/components/admin-list/encabezado-ordenable";
import { Paginador } from "@/components/admin-list/paginador";
import { BarraDelMes, Cifras, type Cifra } from "@/components/modulo/modulo";
import { totalsByCurrency } from "@/lib/accounting/export-rows";
import { createMonthPeriod, getAccountingReport } from "@/lib/accounting/service";
import {
  ETIQUETA_ESTADO_SUELDO, fechaPorDefecto, mesVecino, sueldosDelMes, totalesDeSueldos, type PersonaConSueldo
} from "@/lib/accounting/sueldos";
import { ACCOUNTING_CATEGORY_LABELS } from "@/lib/accounting/types";
import { hrefDePagina, leerOrden, leerPagina, ordenarEnMemoria, paginar, type OrdenDeListado } from "@/lib/admin/list-order";
import { formatCurrency } from "@/lib/admin/salary";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey, argentinaDayStart } from "@/lib/booking/admin-filters";
import { prisma } from "@/lib/db/prisma";
import { terminalDe } from "@/lib/public-service/board";
import { formatoHoras, resumenPorChofer } from "@/lib/public-service/workdays";
import { createExpenseAction, createSalaryPaymentAction } from "./actions";
import { NuevoEgreso, PagoDeSueldo } from "./modales";
import "./contabilidad.css";

type AccountingPageProps = {
  searchParams?: Promise<{ month?: string; notice?: string; orden?: string; dir?: string; page?: string }>;
};

const BASE = "/admin/contabilidad";
const POR_PAGINA = 25;
/** Columnas ordenables de los egresos (issue #192). Por defecto, el más reciente arriba. */
const COLUMNAS = ["fecha", "categoria", "monto", "nave", "persona", "nota"] as const;
type Columna = (typeof COLUMNAS)[number];
const POR_DEFECTO: OrdenDeListado<Columna> = { columna: "fecha", direccion: "desc" };
const mesFormatter = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

function categoriaLabel(category: string) {
  return ACCOUNTING_CATEGORY_LABELS[category as keyof typeof ACCOUNTING_CATEGORY_LABELS] ?? category;
}

function formatDate(date: Date) {
  return date.toLocaleDateString("es-AR", { timeZone: "UTC" });
}

/**
 * Contabilidad: el trabajo del mes (rediseño del 25-nov, sobre #457). Arriba, el mes y cuánto entró,
 * cuánto salió y cuánto falta pagar de sueldos —por moneda, sin sumar pesos con dólares—. Después
 * «Sueldos del mes»: cada chofer y secretaria con lo pactado, lo pagado para ese período y lo que
 * falta, más la base de días, salidas y horas de servicio público de cada chofer (el bloque que
 * #457 trajo desde Servicio público). Al final, en qué se fueron los egresos y la lista.
 *
 * Los agrupados por nave y la exportación a Excel siguen en Reportes.
 */
export default async function AccountingPage({ searchParams }: AccountingPageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const params = (await searchParams) ?? {};
  const period = createMonthPeriod(params.month);
  const mes = period.from.toISOString().slice(0, 7);
  const hoy = argentinaDateKey();
  const mesDeHoy = hoy.slice(0, 7);
  // El filtro de Contabilidad es un mes UTC; para los días trabajados usamos el día argentino,
  // igual que Servicio público, así una salida de las 22:30 cuenta en el día que salió.
  const mesInicio = period.from.toISOString().slice(0, 10);
  const mesSiguiente = period.to.toISOString().slice(0, 10);

  const [report, vehicles, personas, pagos, mesRows] = await Promise.all([
    getAccountingReport({ period }),
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { role: { in: ["DRIVER", "SECRETARY"] } },
      orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, role: true, isActive: true, monthlySalaryCents: true, salaryCurrency: true }
    }),
    // Los pagos del período del sueldo, no de la fecha de pago: el de noviembre se paga en diciembre.
    prisma.accountingEntry.findMany({
      where: { category: { in: ["DRIVER_SALARY", "SECRETARY_SALARY"] }, salaryPeriod: mes, userId: { not: null } },
      select: { userId: true, amountCents: true, currency: true }
    }),
    prisma.schedule.findMany({
      where: {
        departureAt: { gte: argentinaDayStart(mesInicio), lt: argentinaDayStart(mesSiguiente) },
        driverId: { not: null },
        status: { not: "CANCELLED" },
        route: { is: { bookingMode: "SEATED", isActive: true } }
      },
      select: { departureAt: true, arrivalAt: true, driver: { select: { id: true, name: true, email: true } }, route: { select: { from: true } } }
    })
  ]);

  const resumenMes = resumenPorChofer(
    mesRows
      .filter((row) => terminalDe(row.route.from))
      .map((row) => ({
        driverId: row.driver?.id ?? null,
        driverName: row.driver ? row.driver.name?.trim() || row.driver.email : null,
        departureAt: new Date(row.departureAt),
        arrivalAt: new Date(row.arrivalAt)
      }))
  );
  const mesLabel = mesFormatter.format(period.from);

  // Sueldos del mes: lo pactado, lo pagado para el período y la base de servicio público.
  const conSueldo: PersonaConSueldo[] = personas.map((persona) => ({
    id: persona.id,
    nombre: persona.name?.trim() || persona.email,
    rol: persona.role === "SECRETARY" ? "SECRETARY" : "DRIVER",
    activo: persona.isActive,
    sueldoCents: persona.monthlySalaryCents,
    moneda: persona.salaryCurrency || "ARS"
  }));
  // Quien manejó y hoy ya no tiene rol de chofer también entra, sin sueldo de ficha.
  for (const chofer of resumenMes) {
    if (!conSueldo.some((persona) => persona.id === chofer.driverId)) {
      conSueldo.push({ id: chofer.driverId, nombre: chofer.driverName, rol: "DRIVER", activo: false, sueldoCents: null, moneda: "ARS" });
    }
  }
  const sueldos = sueldosDelMes(
    conSueldo,
    pagos.map((pago) => ({ userId: pago.userId!, amountCents: pago.amountCents, currency: pago.currency })),
    resumenMes.map((chofer) => ({ driverId: chofer.driverId, dias: chofer.dias.length, salidas: chofer.salidas, horas: chofer.horas }))
  );
  const totalesSueldos = totalesDeSueldos(sueldos);
  const usuariosParaPago = personas
    .filter((persona) => persona.isActive)
    .map((persona) => ({ id: persona.id, name: persona.name, email: persona.email, role: persona.role, monthlySalaryCents: persona.monthlySalaryCents }));

  // Cifras por moneda: nunca se suman pesos con dólares (antes «Saldo» los mezclaba).
  const totales = totalsByCurrency(report);
  const monedas = [...new Set([...totales.map((t) => t.currency), ...totalesSueldos.map((t) => t.moneda)])];
  if (!monedas.length) monedas.push("ARS");
  const varias = monedas.length > 1;
  const cifrasDe = (moneda: string): Cifra[] => {
    const t = totales.find((total) => total.currency === moneda) ?? { incomeCents: 0, expenseCents: 0 };
    const s = totalesSueldos.find((total) => total.moneda === moneda);
    const sufijo = varias ? ` (${moneda})` : "";
    return [
      { rotulo: `Ingresos${sufijo}`, valor: formatCurrency(t.incomeCents, moneda) },
      { rotulo: `Egresos${sufijo}`, valor: formatCurrency(t.expenseCents, moneda) },
      { rotulo: `Saldo${sufijo}`, valor: formatCurrency(t.incomeCents - t.expenseCents, moneda), alerta: t.incomeCents - t.expenseCents < 0 },
      {
        rotulo: s && s.personasPendientes ? `Sueldos por pagar · ${s.personasPendientes} ${s.personasPendientes === 1 ? "persona" : "personas"}${sufijo}` : `Sueldos por pagar${sufijo}`,
        valor: s && s.pendienteCents ? formatCurrency(s.pendienteCents, moneda) : "Nada pendiente",
        alerta: Boolean(s?.pendienteCents),
        href: "#sueldos"
      }
    ];
  };

  // En qué se fue la plata: los egresos por categoría, con una barra relativa a la mayor (por moneda).
  const categorias = report.expensesByCategory;
  const mayorDe = (moneda: string) => Math.max(1, ...categorias.filter((g) => g.currency === moneda).map((g) => g.amountCents));

  // Los egresos del mes ya vienen enteros (el informe los suma): se ordenan y paginan en memoria.
  const orden = leerOrden(COLUMNAS, POR_DEFECTO, params);
  const egresos = ordenarEnMemoria(report.expenses, orden, {
    fecha: (entry) => entry.occurredAt,
    categoria: (entry) => categoriaLabel(entry.category),
    // Montos de monedas distintas no se comparan: primero la moneda, después el importe.
    monto: (entry) => `${entry.currency} ${String(entry.amountCents).padStart(15, "0")}`,
    nave: (entry) => entry.vehicle?.name,
    persona: (entry) => entry.user?.name ?? entry.user?.email,
    nota: (entry) => entry.notes
  });
  const pagina = paginar(egresos, leerPagina(params.page), POR_PAGINA);
  const encabezado = (etiqueta: string, columna: Columna) => (
    <EncabezadoOrdenable etiqueta={etiqueta} columna={columna} orden={orden} base={BASE} params={params} />
  );
  const fechaSugerida = fechaPorDefecto(mes, hoy);
  const fichaDe = (fila: (typeof sueldos)[number]) => (fila.rol === "DRIVER" ? `/admin/choferes/${fila.userId}` : `/admin/secretarias/${fila.userId}`);

  return (
    <AdminShell role={sessionUser.role} title="Contabilidad" eyebrow="Administración" notice={params.notice}
      action={<div className="inline-actions">
        <Link className="ghost-button" href={`/admin/reportes?month=${mes}`}>Reporte y Excel</Link>
        <NuevoEgreso action={createExpenseAction} vehicles={vehicles} mes={mes} fecha={fechaSugerida} mesLabel={mesLabel} />
        {usuariosParaPago.length ? (
          <PagoDeSueldo action={createSalaryPaymentAction} users={usuariosParaPago} mes={mes} fecha={fechaSugerida} trigger="Registrar pago de sueldo" triggerClassName="button" />
        ) : null}
      </div>}>
      <BarraDelMes
        accion={BASE}
        mes={mes}
        anterior={`${BASE}?month=${mesVecino(mes, -1)}`}
        siguiente={`${BASE}?month=${mesVecino(mes, 1)}`}
        esteMes={mes !== mesDeHoy ? `${BASE}?month=${mesDeHoy}` : null}
      />
      <div className="cont-cifras">
        {monedas.map((moneda) => <Cifras key={moneda} etiqueta={`Resumen de ${mesLabel}${varias ? ` en ${moneda}` : ""}`} cifras={cifrasDe(moneda)} />)}
      </div>
      <p className="muted flights-note">
        <strong>{mesLabel.replace(/^./, (letra) => letra.toUpperCase())}</strong> · los ingresos son las reservas pagadas o confirmadas del mes;
        los egresos, lo que se cargó acá (incluidos los sueldos pagados en el mes).
      </p>

      <section className="plain-card admin-section cont-sueldos" id="sueldos" aria-labelledby="cont-sueldos-titulo">
        <header className="cont-seccion-cabeza">
          <div>
            <h2 id="cont-sueldos-titulo">Sueldos de {mesLabel}</h2>
            <p className="muted">
              Lo pactado es el sueldo mensual de la ficha; lo pagado, los pagos con período {mesLabel}, aunque se hayan hecho
              después. Días, salidas y horas: base para liquidación, sólo servicio público.
            </p>
          </div>
          {totalesSueldos.map((total) => (
            <div key={total.moneda} className="cont-sueldos-total">
              <span>Pagado {formatCurrency(total.pagadoCents, total.moneda)} de {formatCurrency(total.pactadoCents, total.moneda)}</span>
              <div className="cont-barra" aria-hidden><span style={{ width: `${total.pactadoCents ? Math.min(100, (total.pagadoCents / total.pactadoCents) * 100) : 0}%` }} /></div>
            </div>
          ))}
        </header>
        {sueldos.length ? (
          <div className="cont-tabla-scroll">
            <table className="data-table embedded-table cont-sueldos-tabla">
              <thead>
                <tr>
                  <th scope="col">Persona</th>
                  <th scope="col" className="cont-num">Días</th>
                  <th scope="col" className="cont-num">Salidas</th>
                  <th scope="col" className="cont-num">Horas</th>
                  <th scope="col" className="cont-num">Sueldo</th>
                  <th scope="col" className="cont-num">Pagado</th>
                  <th scope="col" className="cont-num">Falta</th>
                  <th scope="col">Estado</th>
                  <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {sueldos.map((fila) => (
                  <tr key={fila.userId} data-estado={fila.estado}>
                    <td data-label="Persona">
                      <Link href={fichaDe(fila)}>{fila.nombre}</Link>
                      <small>{fila.rol === "DRIVER" ? "Chofer" : "Secretaria"}{fila.activo ? "" : " · inactivo"}</small>
                    </td>
                    {/* Base de servicio público (sólo choferes): lo que #457 trajo desde Servicio público. */}
                    <td data-label="Días" className="cont-num">{fila.base ? <strong>{fila.base.dias}</strong> : <span className="muted">—</span>}</td>
                    <td data-label="Salidas" className="cont-num">{fila.base ? fila.base.salidas : <span className="muted">—</span>}</td>
                    <td data-label="Horas" className="cont-num">{fila.base ? formatoHoras(fila.base.horas) : <span className="muted">—</span>}</td>
                    <td data-label="Sueldo" className="cont-num">{fila.sueldoCents ? formatCurrency(fila.sueldoCents, fila.moneda) : <Link className="cont-falta-dato" href={fichaDe(fila)}>Cargar en la ficha</Link>}</td>
                    <td data-label="Pagado" className="cont-num">
                      {fila.pagadoCents ? formatCurrency(fila.pagadoCents, fila.moneda) : "—"}
                      {fila.pagosEnOtraMoneda.map((otro) => <small key={otro.currency}>+ {formatCurrency(otro.amountCents, otro.currency)} en otra moneda</small>)}
                    </td>
                    <td data-label="Falta" className="cont-num"><strong>{fila.pendienteCents ? formatCurrency(fila.pendienteCents, fila.moneda) : fila.pendienteCents === 0 ? "—" : "?"}</strong></td>
                    <td data-label="Estado"><span className="cont-estado" data-estado={fila.estado}>{ETIQUETA_ESTADO_SUELDO[fila.estado]}</span></td>
                    <td className="cont-accion">
                      {fila.activo ? (
                        <PagoDeSueldo action={createSalaryPaymentAction} users={usuariosParaPago} mes={mes} fecha={fechaSugerida}
                          userId={fila.userId} montoCents={fila.pendienteCents} nombre={fila.nombre}
                          trigger={fila.estado === "pagado" || fila.estado === "de-mas" ? "Otro pago" : "Pagar"}
                          triggerClassName="ghost-button modulo-asignar" />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No hay choferes ni secretarias activos. Cargalos desde Choferes o Secretarias para liquidar sus sueldos.</p>
        )}
      </section>

      <section className="plain-card admin-section cont-categorias" aria-labelledby="cont-categorias-titulo">
        <header className="cont-seccion-cabeza">
          <h2 id="cont-categorias-titulo">En qué se fueron los egresos</h2>
        </header>
        {categorias.length ? (
          <ul className="cont-categorias-lista" role="list">
            {categorias.map((grupo) => (
              <li key={`${grupo.id}-${grupo.currency}`}>
                <span>{grupo.label}{varias ? ` (${grupo.currency})` : ""}</span>
                <div className="cont-barra" aria-hidden><span style={{ width: `${(grupo.amountCents / mayorDe(grupo.currency)) * 100}%` }} /></div>
                <strong>{formatCurrency(grupo.amountCents, grupo.currency)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Todavía no hay egresos cargados en {mesLabel}.</p>
        )}
      </section>

      <section className="plain-card admin-section" aria-labelledby="cont-egresos-titulo">
        <header className="cont-seccion-cabeza">
          <h2 id="cont-egresos-titulo">Egresos de {mesLabel}</h2>
          <span className="muted">{report.expenses.length} {report.expenses.length === 1 ? "movimiento" : "movimientos"}</span>
        </header>
        <div className="cont-tabla-scroll">
          <table className="data-table embedded-table">
            <thead>
              <tr>
                {encabezado("Fecha", "fecha")}
                {encabezado("Categoría", "categoria")}
                {encabezado("Monto", "monto")}
                {encabezado("Nave", "nave")}
                {encabezado("Persona", "persona")}
                {encabezado("Nota", "nota")}
              </tr>
            </thead>
            <tbody>
              {pagina.items.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.occurredAt)}</td>
                  <td>{categoriaLabel(entry.category)}{entry.salaryPeriod ? <small className="muted"> · período {entry.salaryPeriod.split("-").reverse().join("/")}</small> : null}</td>
                  <td>{formatCurrency(entry.amountCents, entry.currency)}</td>
                  <td>{entry.vehicle?.name ?? "—"}</td>
                  <td>{entry.user?.name ?? entry.user?.email ?? "—"}</td>
                  <td>{entry.notes ?? "—"}</td>
                </tr>
              ))}
              {report.expenses.length === 0 ? (
                <tr>
                  <td colSpan={6}>Todavía no hay egresos cargados en {mesLabel}.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Paginador {...pagina} hrefPagina={(n) => hrefDePagina(BASE, params, n)} etiqueta="egresos" />
      </section>
    </AdminShell>
  );
}
