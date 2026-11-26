import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { EncabezadoOrdenable } from "@/components/admin-list/encabezado-ordenable";
import { Paginador } from "@/components/admin-list/paginador";
import { BarraDelMes, ChipsDeFiltro, Cifras, SelectorDeVista, type Cifra } from "@/components/modulo/modulo";
import { totalsByCurrency } from "@/lib/accounting/export-rows";
import { createMonthPeriod, getAccountingReport } from "@/lib/accounting/service";
import {
  COLUMNAS_DE_INGRESOS,
  COLUMNAS_DE_LIQUIDACIONES,
  ORDEN_DE_INGRESOS,
  ORDEN_DE_INGRESOS_POR_DEFECTO,
  ORDEN_DE_LIQUIDACIONES,
  ORDEN_DE_LIQUIDACIONES_POR_DEFECTO,
  TAMANOS_DE_PAGINA,
  filtrarIngresos,
  filtrarLiquidaciones,
  leerColumnasDeIngresos,
  leerColumnasDeLiquidaciones,
  leerTamanoDePagina,
  ordenarIngresos,
  ordenarLiquidaciones,
  periodoDeIngresos,
  type ColumnaDeIngreso,
  type ColumnaDeLiquidacion,
  type EstadoDeSueldoFiltro,
  type OrdenDeIngreso,
  type OrdenDeLiquidacion,
  type VistaDeIngresos
} from "@/lib/accounting/list-filters";
import {
  ETIQUETA_ESTADO_SUELDO, fechaPorDefecto, mesVecino, sueldosDelMes, totalesDeSueldos, type PersonaConSueldo
} from "@/lib/accounting/sueldos";
import { ETIQUETA_SECCION, SECCIONES, codigoCorto, rutaCorta, seccionDeContabilidad, type Seccion } from "@/lib/accounting/secciones";
import { ACCOUNTING_CATEGORY_LABELS } from "@/lib/accounting/types";
import {
  hrefDePagina, leerOrden, leerPagina, ordenarEnMemoria, paginar, type OrdenDeListado
} from "@/lib/admin/list-order";
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
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const BASE = "/admin/contabilidad";
const POR_PAGINA = 25;
/** Columnas ordenables de los egresos (issue #192). Por defecto, el más reciente arriba. */
const COLUMNAS = ["fecha", "categoria", "monto", "nave", "persona", "nota"] as const;
type Columna = (typeof COLUMNAS)[number];
const POR_DEFECTO: OrdenDeListado<Columna> = { columna: "fecha", direccion: "desc" };
const mesFormatter = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const fechaCortaFormatter = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const VISTA_ETIQUETA: Record<VistaDeIngresos, string> = { mes: "Mes", semana: "Semana", dia: "Día", rango: "Desde/hasta" };

function etiquetaDeIngreso(ingreso: { status: string; paymentStatus: string | null }) {
  if (ingreso.status === "CANCELLED") {
    return ingreso.paymentStatus === "APPROVED" ? "Cancelada con pago" : "Cancelada";
  }
  if (ingreso.status === "CONFIRMED") {
    return ingreso.paymentStatus === "APPROVED" ? "Pago aprobado" : "Confirmada";
  }
  return "Pendiente";
}

function CamposOcultos({ params, omitir = [] }: { params: Record<string, string | string[] | undefined>; omitir?: string[] }) {
  return (
    <>
      {Object.entries(params).flatMap(([clave, valor]) => {
        if (clave === "notice" || clave === "n" || omitir.includes(clave) || !valor) return [];
        return Array.isArray(valor)
          ? valor.map((item, indice) => <input key={`${clave}-${indice}`} type="hidden" name={clave} value={item} />)
          : [<input key={clave} type="hidden" name={clave} value={valor} />];
      })}
    </>
  );
}

function categoriaLabel(category: string) {
  return ACCOUNTING_CATEGORY_LABELS[category as keyof typeof ACCOUNTING_CATEGORY_LABELS] ?? category;
}

function formatDate(date: Date) {
  return date.toLocaleDateString("es-AR", { timeZone: "UTC" });
}

/** «20/11»: el año ya está en el período elegido; el completo queda en el `title`. */
function fechaCorta(date: Date) {
  return fechaCortaFormatter.format(date);
}

/**
 * Contabilidad: el trabajo del mes (25-nov sobre #457; secciones el 26-nov, sobre #461). Arriba, el
 * selector Resumen · Ingresos · Sueldos · Egresos, el mes y cuánto entró, cuánto salió y cuánto falta
 * pagar de sueldos —por moneda, sin sumar pesos con dólares—. Abajo, una sección por vez:
 *
 * - Resumen: los sueldos que faltan pagar (con «Pagar» a mano), los últimos ingresos y en qué se
 *   fueron los egresos, con combustible por nave. Cada bloque lleva a su sección.
 * - Ingresos: la tabla de #461 (período, filtros, columnas, orden y páginas), en un renglón por reserva.
 * - Sueldos: lo pactado, lo pagado para el período, lo que falta y la base de servicio público.
 * - Egresos: la lista, con el chip «Combustible» (antes era una tarjeta aparte).
 *
 * Los agrupados por nave y la exportación a Excel siguen en Reportes.
 */
export default async function AccountingPage({ searchParams }: AccountingPageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const params = (await searchParams) ?? {};
  const texto = (valor: string | string[] | undefined) => typeof valor === "string" ? valor : undefined;
  // Cambia con cada guardado (ver noticeRedirect): el modal abierto se cierra al volver.
  const modalKey = texto(params.n) ?? texto(params.notice) ?? "";
  const period = createMonthPeriod(texto(params.month));
  const mes = period.from.toISOString().slice(0, 7);
  const hoy = argentinaDateKey();
  const mesDeHoy = hoy.slice(0, 7);
  // El filtro de Contabilidad es un mes UTC; para los días trabajados usamos el día argentino,
  // igual que Servicio público, así una salida de las 22:30 cuenta en el día que salió.
  const mesInicio = period.from.toISOString().slice(0, 10);
  const mesSiguiente = period.to.toISOString().slice(0, 10);
  const seccion = seccionDeContabilidad(params);
  const hrefSeccion = (destino: Seccion, mesDestino = mes) =>
    `${BASE}?month=${mesDestino}${destino === "resumen" ? "" : `&seccion=${destino}`}`;

  const periodoIngresos = periodoDeIngresos(params);
  const [report, incomeReport, vehicles, personas, pagos, mesRows] = await Promise.all([
    getAccountingReport({ period }),
    getAccountingReport({ period: periodoIngresos.period }),
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
        OR: [{ driverId: { not: null } }, { extraUnits: { some: { driverId: { not: null } } } }],
        status: { not: "CANCELLED" },
        route: { is: { bookingMode: "SEATED", isActive: true } }
      },
      select: {
        departureAt: true, arrivalAt: true, driver: { select: { id: true, name: true, email: true } },
        extraUnits: { select: { driver: { select: { id: true, name: true, email: true } } } }, route: { select: { from: true } }
      }
    })
  ]);

  const resumenMes = resumenPorChofer(
    mesRows
      .filter((row) => terminalDe(row.route.from))
      .flatMap((row) => {
        const asignados = [row.driver, ...row.extraUnits.map((unit) => unit.driver)];
        const unicos = new Map(asignados.filter((driver) => driver !== null).map((driver) => [driver.id, driver]));
        return Array.from(unicos.values(), (driver) => ({
          driverId: driver.id,
          driverName: driver.name?.trim() || driver.email,
          departureAt: new Date(row.departureAt),
          arrivalAt: new Date(row.arrivalAt)
        }));
      })
  );
  const mesLabel = mesFormatter.format(period.from);
  const cargas = report.expenses.filter((entry) => entry.category === "FUEL");
  const porNave = new Map<string, { nave: string; moneda: string; centavos: number }>();
  for (const carga of cargas) {
    const key = JSON.stringify([carga.vehicle?.id ?? null, carga.currency]);
    const grupo = porNave.get(key) ?? { nave: carga.vehicle?.name ?? "Sin nave asignada", moneda: carga.currency, centavos: 0 };
    grupo.centavos += carga.amountCents;
    porNave.set(key, grupo);
  }
  const totalesCombustible = [...porNave.values()].reduce<Array<{ moneda: string; centavos: number }>>((totales, grupo) => {
    const total = totales.find((item) => item.moneda === grupo.moneda);
    if (total) total.centavos += grupo.centavos;
    else totales.push({ moneda: grupo.moneda, centavos: grupo.centavos });
    return totales;
  }, []);
  const importeConMoneda = (cents: number, currency: string) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);

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

  const tamanoPagina = leerTamanoDePagina(params.pageSize);
  const hrefCon = (cambios: Record<string, string | undefined>, borrar: string[] = []) => {
    const query = new URLSearchParams();
    for (const [clave, valor] of Object.entries(params)) {
      if (typeof valor !== "string" || !valor || clave === "notice" || clave === "n" || borrar.includes(clave)) continue;
      query.set(clave, valor);
    }
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) query.set(clave, valor);
    }
    return `${BASE}?${query.toString()}`;
  };

  // Ingresos: período independiente del mes de sueldos para poder mirar una semana o un rango.
  const ordenIngresos = leerOrden<OrdenDeIngreso>(ORDEN_DE_INGRESOS, ORDEN_DE_INGRESOS_POR_DEFECTO, {
    orden: texto(params.ordenIngresos), dir: texto(params.dirIngresos)
  });
  const ingresosFiltrados = ordenarIngresos(
    filtrarIngresos(incomeReport.incomes, { q: texto(params.qIngresos), driverId: texto(params.driverId) }),
    ordenIngresos
  );
  const paginaIngresos = paginar(ingresosFiltrados, leerPagina(params.pageIngresos), tamanoPagina);
  const columnasIngresos = leerColumnasDeIngresos(params.colsIngresos);
  const setColumnasIngresos = new Set<ColumnaDeIngreso>(columnasIngresos);
  const choferesDeIngresos = [...new Map(
    incomeReport.incomes
      .filter((ingreso) => ingreso.driverId)
      .map((ingreso) => [ingreso.driverId!, ingreso.driverName ?? "Chofer sin nombre"])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  const hayIngresosSinChofer = incomeReport.incomes.some((ingreso) => !ingreso.driverId);
  const totalesIngresos = totalsByCurrency(incomeReport);

  // Liquidaciones: el mes sigue siendo el período del sueldo; la tabla se ordena, filtra y pagina.
  const ordenLiquidaciones = leerOrden<OrdenDeLiquidacion>(ORDEN_DE_LIQUIDACIONES, ORDEN_DE_LIQUIDACIONES_POR_DEFECTO, {
    orden: texto(params.ordenSueldos), dir: texto(params.dirSueldos)
  });
  const estadosDeSueldo = Object.keys(ETIQUETA_ESTADO_SUELDO) as Exclude<EstadoDeSueldoFiltro, "todos">[];
  const estadoParametro = texto(params.estadoSueldo);
  const estadoSueldo: EstadoDeSueldoFiltro = estadoParametro && estadosDeSueldo.includes(estadoParametro as Exclude<EstadoDeSueldoFiltro, "todos">)
    ? (estadoParametro as Exclude<EstadoDeSueldoFiltro, "todos">)
    : "todos";
  const rolSueldo = texto(params.rolSueldo) === "DRIVER" || texto(params.rolSueldo) === "SECRETARY"
    ? texto(params.rolSueldo) as "DRIVER" | "SECRETARY"
    : "todos";
  const liquidaciones = ordenarLiquidaciones(
    filtrarLiquidaciones(sueldos, { q: texto(params.qSueldos), rol: rolSueldo, estado: estadoSueldo }),
    ordenLiquidaciones
  );
  const paginaLiquidaciones = paginar(liquidaciones, leerPagina(params.pageSueldos), tamanoPagina);
  const columnasLiquidaciones = leerColumnasDeLiquidaciones(params.colsSueldos);
  const setColumnasLiquidaciones = new Set<ColumnaDeLiquidacion>(columnasLiquidaciones);

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
        href: hrefSeccion("sueldos")
      }
    ];
  };

  // En qué se fue la plata: los egresos por categoría, con una barra relativa a la mayor (por moneda).
  const categorias = report.expensesByCategory;
  const mayorDe = (moneda: string) => Math.max(1, ...categorias.filter((g) => g.currency === moneda).map((g) => g.amountCents));

  // Los egresos del mes ya vienen enteros (el informe los suma): se ordenan y paginan en memoria.
  const orden = leerOrden<Columna>(COLUMNAS, POR_DEFECTO, { orden: texto(params.orden), dir: texto(params.dir) });
  const soloCombustible = texto(params.gasto) === "combustible";
  const egresos = ordenarEnMemoria(soloCombustible ? cargas : report.expenses, orden, {
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
  const hrefVista = (vista: VistaDeIngresos) => hrefCon(
    {
      vista,
      ...(vista === "mes" ? { month: mes } : {}),
      ...(vista === "semana" ? { semana: periodoIngresos.semana } : {}),
      ...(vista === "dia" ? { dia: periodoIngresos.dia } : {}),
      ...(vista === "rango" ? { desde: periodoIngresos.desde, hasta: periodoIngresos.hasta } : {})
    },
    ["vista", "semana", "dia", "desde", "hasta", "pageIngresos"]
  );
  const hrefTamano = (filas: number) => hrefCon({ pageSize: String(filas) }, ["page", "pageIngresos", "pageSueldos"]);
  const encabezadoIngreso = (etiqueta: string, columna: OrdenDeIngreso) => (
    <EncabezadoOrdenable
      etiqueta={etiqueta}
      columna={columna}
      orden={ordenIngresos}
      base={BASE}
      params={params}
      clavePagina="pageIngresos"
      clavesOrden={{ orden: "ordenIngresos", dir: "dirIngresos" }}
    />
  );
  const encabezadoLiquidacion = (etiqueta: string, columna: OrdenDeLiquidacion) => (
    <EncabezadoOrdenable
      etiqueta={etiqueta}
      columna={columna}
      orden={ordenLiquidaciones}
      base={BASE}
      params={params}
      clavePagina="pageSueldos"
      clavesOrden={{ orden: "ordenSueldos", dir: "dirSueldos" }}
    />
  );


  // Resumen: lo que pide atención primero (sueldos), lo último que entró y en qué se fue la plata.
  const porPagar = sueldos.filter((fila) => fila.activo && (fila.estado === "pendiente" || fila.estado === "parcial" || fila.estado === "sin-sueldo"));
  const ultimosIngresos = [...report.incomes].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 5);
  const ingresosSinChofer = report.incomes.filter((ingreso) => !ingreso.driverId).length;
  const navesDeCombustible = [...porNave.values()].sort((a, b) => a.moneda.localeCompare(b.moneda) || b.centavos - a.centavos);
  const ver = (texto: string, destino: Seccion) => <Link className="cont-ver-todo" href={hrefSeccion(destino)}>{texto} →</Link>;
  const pagoDe = (fila: (typeof sueldos)[number], trigger: string, triggerClassName = "ghost-button modulo-asignar") => (
    <PagoDeSueldo action={createSalaryPaymentAction} users={usuariosParaPago} mes={mes} fecha={fechaSugerida}
      userId={fila.userId} montoCents={fila.pendienteCents} nombre={fila.nombre} closeKey={modalKey}
      trigger={trigger} triggerClassName={triggerClassName} seccion={seccion} />
  );
  const mesConMayuscula = mesLabel.replace(/^./, (letra) => letra.toUpperCase());

  return (
    <AdminShell role={sessionUser.role} title="Contabilidad" eyebrow="Administración" notice={texto(params.notice)}
      action={<div className="inline-actions">
        <Link className="ghost-button" href={`/admin/reportes?month=${mes}`}>Reporte y Excel</Link>
        <NuevoEgreso action={createExpenseAction} vehicles={vehicles} mes={mes} fecha={fechaSugerida} mesLabel={mesLabel} closeKey={modalKey} seccion={seccion} />
        {usuariosParaPago.length ? (
          <PagoDeSueldo action={createSalaryPaymentAction} users={usuariosParaPago} mes={mes} fecha={fechaSugerida} trigger="Registrar pago de sueldo" triggerClassName="button" closeKey={modalKey} seccion={seccion} />
        ) : null}
      </div>}>
      <SelectorDeVista
        opciones={SECCIONES.map((id) => ({ id, etiqueta: ETIQUETA_SECCION[id], href: hrefSeccion(id) }))}
        actual={seccion}
      />
      <BarraDelMes
        accion={BASE}
        mes={mes}
        anterior={hrefSeccion(seccion, mesVecino(mes, -1))}
        siguiente={hrefSeccion(seccion, mesVecino(mes, 1))}
        esteMes={mes !== mesDeHoy ? hrefSeccion(seccion, mesDeHoy) : null}
        ocultos={{ seccion: seccion === "resumen" ? null : seccion }}
      />
      <div className="cont-cifras">
        {monedas.map((moneda) => <Cifras key={moneda} etiqueta={`Resumen de ${mesLabel}${varias ? ` en ${moneda}` : ""}`} cifras={cifrasDe(moneda)} />)}
      </div>

      {seccion === "resumen" ? (
        <>
          <p className="muted flights-note">
            <strong>{mesConMayuscula}</strong> · los ingresos son las reservas pagadas o confirmadas del mes;
            los egresos, lo que se cargó acá (incluidos los sueldos pagados en el mes).
          </p>
          <div className="cont-resumen">
            <section className="plain-card admin-section cont-bloque" aria-labelledby="cont-r-sueldos">
              <header className="cont-bloque-cabeza">
                <h2 id="cont-r-sueldos">Sueldos por pagar</h2>
                {ver(`Ver los ${sueldos.length} sueldos`, "sueldos")}
              </header>
              {totalesSueldos.map((total) => (
                <div key={total.moneda} className="cont-sueldos-total">
                  <span>Pagado {formatCurrency(total.pagadoCents, total.moneda)} de {formatCurrency(total.pactadoCents, total.moneda)}</span>
                  <div className="cont-barra" aria-hidden><span style={{ width: `${total.pactadoCents ? Math.min(100, (total.pagadoCents / total.pactadoCents) * 100) : 0}%` }} /></div>
                </div>
              ))}
              {porPagar.length ? (
                <ul className="cont-lista" role="list">
                  {porPagar.slice(0, 6).map((fila) => (
                    <li key={fila.userId} data-estado={fila.estado}>
                      <span className="cont-lista-quien">
                        <strong>{fila.nombre}</strong>
                        <small>{fila.rol === "DRIVER" ? "Chofer" : "Secretaria"} · {ETIQUETA_ESTADO_SUELDO[fila.estado]}</small>
                      </span>
                      {fila.estado === "sin-sueldo" ? (
                        <Link className="cont-falta-dato" href={fichaDe(fila)}>Cargar en la ficha</Link>
                      ) : (
                        <>
                          <strong className="cont-num">{formatCurrency(fila.pendienteCents ?? 0, fila.moneda)}</strong>
                          {pagoDe(fila, "Pagar")}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cont-vacio">Están todos pagos para {mesLabel}.</p>
              )}
              {porPagar.length > 6 ? <p className="muted cont-mas">Y {porPagar.length - 6} más en Sueldos.</p> : null}
            </section>

            <section className="plain-card admin-section cont-bloque" aria-labelledby="cont-r-ingresos">
              <header className="cont-bloque-cabeza">
                <h2 id="cont-r-ingresos">Ingresos</h2>
                {ver(`Ver los ${report.incomes.length} ingresos`, "ingresos")}
              </header>
              <p className="cont-bloque-dato">
                {report.incomes.length} {report.incomes.length === 1 ? "reserva pagada o confirmada" : "reservas pagadas o confirmadas"}
                {ingresosSinChofer ? <> · <span className="muted">{ingresosSinChofer} sin chofer</span></> : null}
              </p>
              {ultimosIngresos.length ? (
                <ul className="cont-lista" role="list" aria-label="Últimos ingresos">
                  {ultimosIngresos.map((ingreso) => (
                    <li key={ingreso.id}>
                      <span className="cont-lista-fecha" title={formatDate(ingreso.occurredAt)}>{fechaCorta(ingreso.occurredAt)}</span>
                      <span className="cont-lista-quien">
                        <strong>{rutaCorta(ingreso.routeFrom, ingreso.routeTo)}</strong>
                        <small title={ingreso.code}>{codigoCorto(ingreso.code)} · {etiquetaDeIngreso(ingreso)}</small>
                      </span>
                      <strong className="cont-num">{formatCurrency(ingreso.amountCents, ingreso.currency)}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cont-vacio">Todavía no hay ingresos en {mesLabel}.</p>
              )}
            </section>

            <section className="plain-card admin-section cont-bloque cont-bloque-ancho" aria-labelledby="cont-r-egresos">
              <header className="cont-bloque-cabeza">
                <h2 id="cont-r-egresos">En qué se fueron los egresos</h2>
                {ver(`Ver los ${report.expenses.length} egresos`, "egresos")}
              </header>
              <div className="cont-egresos-resumen">
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
                  <p className="cont-vacio">Todavía no hay egresos cargados en {mesLabel}.</p>
                )}
                <div className="cont-combustible" id="combustible">
                  <h3>Combustible por nave</h3>
                  {navesDeCombustible.length ? (
                    <ul role="list">
                      {navesDeCombustible.map((grupo, indice) => (
                        <li key={`${grupo.nave}-${grupo.moneda}-${indice}`}>
                          <span>{grupo.nave}</span>
                          <strong className="cont-num">{importeConMoneda(grupo.centavos, grupo.moneda)}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">Sin cargas de combustible en {mesLabel}.</p>
                  )}
                  <div className="cont-combustible-pie">
                    {cargas.length ? <Link href={`${BASE}?month=${mes}&seccion=egresos&gasto=combustible`}>Ver las {cargas.length} cargas</Link> : null}
                    <NuevoEgreso combustible action={createExpenseAction} vehicles={vehicles} mes={mes} fecha={fechaSugerida} mesLabel={mesLabel} closeKey={modalKey} seccion={seccion} />
                  </div>
                </div>
              </div>
            </section>
          </div>
        </>
      ) : null}

      {seccion === "ingresos" ? (
      <section className="plain-card admin-section cont-ingresos" id="ingresos" aria-labelledby="cont-ingresos-titulo">
        <header className="cont-seccion-cabeza">
          <div>
            <h2 id="cont-ingresos-titulo">Ingresos</h2>
            <p className="muted">
              Reservas pagadas o confirmadas. La fecha es la del pago aprobado o, si todavía no hay pago, la de la reserva.
            </p>
          </div>
          <div className="cont-ingresos-total">
            <span className="muted">{periodoIngresos.period.label}</span>
            {totalesIngresos.map((total) => (
              <strong key={total.currency}>{formatCurrency(total.incomeCents, total.currency)}</strong>
            ))}
          </div>
        </header>

        <nav className="cont-vistas" aria-label="Ver ingresos por">
          {(["mes", "semana", "dia", "rango"] as const).map((vista) => (
            <Link
              key={vista}
              href={hrefVista(vista)}
              className="cont-vista"
              data-active={periodoIngresos.vista === vista ? "true" : undefined}
              aria-current={periodoIngresos.vista === vista ? "page" : undefined}
            >
              {VISTA_ETIQUETA[vista]}
            </Link>
          ))}
        </nav>

        <form className="cont-filtros" action={BASE} method="get">
          <CamposOcultos
            params={params}
            omitir={["seccion", "vista", "month", "semana", "dia", "desde", "hasta", "qIngresos", "driverId", "pageIngresos"]}
          />
          <input type="hidden" name="seccion" value="ingresos" />
          <input type="hidden" name="vista" value={periodoIngresos.vista} />
          {/* El mes lo elige la barra de arriba: acá no se repite el campo. */}
          <input type="hidden" name="month" value={mes} />
          <div className="cont-filtros-campos">
            {periodoIngresos.vista === "semana" ? (
              <label>Semana de<input type="date" name="semana" defaultValue={periodoIngresos.semana} /></label>
            ) : null}
            {periodoIngresos.vista === "dia" ? (
              <label>Día<input type="date" name="dia" defaultValue={periodoIngresos.dia} /></label>
            ) : null}
            {periodoIngresos.vista === "rango" ? (
              <>
                <label>Desde<input type="date" name="desde" defaultValue={periodoIngresos.desde} /></label>
                <label>Hasta<input type="date" name="hasta" defaultValue={periodoIngresos.hasta} /></label>
              </>
            ) : null}
            <label>Buscar<input type="search" name="qIngresos" defaultValue={texto(params.qIngresos)} placeholder="Código, chofer o ruta" /></label>
            <label>Chofer
              <select name="driverId" defaultValue={texto(params.driverId) ?? ""}>
                <option value="">Todos</option>
                {choferesDeIngresos.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                {hayIngresosSinChofer ? <option value="sin-chofer">Sin chofer</option> : null}
              </select>
            </label>
          </div>
          <div className="cont-filtros-acciones">
            <button className="button" type="submit">Aplicar</button>
            <Link className="ghost-button" href={hrefSeccion("ingresos")}>Limpiar</Link>
          </div>
        </form>

        <details className="cont-columnas">
          <summary>Columnas</summary>
          <form action={BASE} method="get" className="cont-columnas-form">
            <CamposOcultos params={params} omitir={["seccion", "colsIngresos", "pageIngresos"]} />
            <input type="hidden" name="seccion" value="ingresos" />
            <div className="cont-columnas-lista">
              {COLUMNAS_DE_INGRESOS.map((columna) => (
                <label key={columna.id}>
                  <input type="checkbox" name="colsIngresos" value={columna.id} defaultChecked={setColumnasIngresos.has(columna.id)} />
                  {columna.etiqueta}
                </label>
              ))}
            </div>
            <button className="ghost-button" type="submit">Aplicar columnas</button>
          </form>
        </details>

        <div className="cont-tabla-scroll">
          <table className="data-table cont-tabla cont-tabla-ingresos">
            <thead>
              <tr>
                {setColumnasIngresos.has("fecha") ? encabezadoIngreso("Fecha", "fecha") : null}
                {setColumnasIngresos.has("reserva") ? encabezadoIngreso("Reserva", "reserva") : null}
                {setColumnasIngresos.has("ruta") ? encabezadoIngreso("Ruta", "ruta") : null}
                {setColumnasIngresos.has("chofer") ? encabezadoIngreso("Chofer", "chofer") : null}
                {setColumnasIngresos.has("nave") ? encabezadoIngreso("Nave", "nave") : null}
                {setColumnasIngresos.has("estado") ? encabezadoIngreso("Estado", "estado") : null}
                {setColumnasIngresos.has("monto") ? encabezadoIngreso("Monto", "monto") : null}
              </tr>
            </thead>
            <tbody>
              {paginaIngresos.items.map((ingreso) => (
                <tr key={ingreso.id}>
                  {setColumnasIngresos.has("fecha") ? <td data-label="Fecha" className="cont-c-fecha" title={formatDate(ingreso.occurredAt)}>{fechaCorta(ingreso.occurredAt)}</td> : null}
                  {setColumnasIngresos.has("reserva") ? <td data-label="Reserva" className="cont-c-reserva"><span className="cont-codigo" title={ingreso.code}>{codigoCorto(ingreso.code)}</span></td> : null}
                  {setColumnasIngresos.has("ruta") ? <td data-label="Ruta" className="cont-c-ruta" title={ingreso.routeLabel}>{rutaCorta(ingreso.routeFrom, ingreso.routeTo)}</td> : null}
                  {setColumnasIngresos.has("chofer") ? (
                    <td data-label="Chofer" className="cont-c-chofer">
                      {ingreso.driverId ? <Link href={`/admin/choferes/${ingreso.driverId}`}>{ingreso.driverName ?? "Chofer sin nombre"}</Link> : <span className="muted">Sin chofer</span>}
                    </td>
                  ) : null}
                  {setColumnasIngresos.has("nave") ? (
                    <td data-label="Nave" className="cont-c-nave">{ingreso.vehicleId === "sin-nave" ? <span className="muted">—</span> : ingreso.vehicleName}</td>
                  ) : null}
                  {setColumnasIngresos.has("estado") ? <td data-label="Estado" className="cont-c-estado"><span className="cont-estado" data-ingreso={ingreso.status === "CANCELLED" ? "cancelada" : ingreso.paymentStatus === "APPROVED" ? "pagada" : "confirmada"}>{etiquetaDeIngreso(ingreso)}</span></td> : null}
                  {setColumnasIngresos.has("monto") ? <td data-label="Monto" className="cont-monto cont-c-monto">{formatCurrency(ingreso.amountCents, ingreso.currency)}</td> : null}
                </tr>
              ))}
              {!paginaIngresos.items.length ? (
                <tr><td className="muted" colSpan={Math.max(1, columnasIngresos.length)}>No hay ingresos para este período.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Paginador
          page={paginaIngresos.page}
          totalPages={paginaIngresos.totalPages}
          total={paginaIngresos.total}
          desde={paginaIngresos.desde}
          hasta={paginaIngresos.hasta}
          hrefPagina={(numero) => hrefDePagina(BASE, params, numero, "pageIngresos")}
          etiqueta="ingresos"
          pageSize={tamanoPagina}
          tamanos={TAMANOS_DE_PAGINA}
          hrefTamano={hrefTamano}
        />
      </section>
      ) : null}

      {seccion === "sueldos" ? (
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

        <form className="cont-filtros cont-filtros-sueldos" action={BASE} method="get">
          <CamposOcultos params={params} omitir={["seccion", "month", "qSueldos", "rolSueldo", "estadoSueldo", "pageSueldos"]} />
          <input type="hidden" name="seccion" value="sueldos" />
          <input type="hidden" name="month" value={mes} />
          <div className="cont-filtros-campos">
            <label>Buscar<input type="search" name="qSueldos" defaultValue={texto(params.qSueldos)} placeholder="Nombre" /></label>
            <label>Rol
              <select name="rolSueldo" defaultValue={rolSueldo}>
                <option value="todos">Todos</option>
                <option value="DRIVER">Choferes</option>
                <option value="SECRETARY">Secretarias</option>
              </select>
            </label>
            <label>Estado
              <select name="estadoSueldo" defaultValue={estadoSueldo}>
                <option value="todos">Todos</option>
                {estadosDeSueldo.map((estado) => <option key={estado} value={estado}>{ETIQUETA_ESTADO_SUELDO[estado]}</option>)}
              </select>
            </label>
          </div>
          <div className="cont-filtros-acciones">
            <button className="button" type="submit">Aplicar</button>
            <Link className="ghost-button" href={hrefSeccion("sueldos")}>Limpiar</Link>
          </div>
        </form>

        <details className="cont-columnas">
          <summary>Columnas</summary>
          <form action={BASE} method="get" className="cont-columnas-form">
            <CamposOcultos params={params} omitir={["seccion", "colsSueldos", "pageSueldos"]} />
            <input type="hidden" name="seccion" value="sueldos" />
            <div className="cont-columnas-lista">
              {COLUMNAS_DE_LIQUIDACIONES.map((columna) => (
                <label key={columna.id}>
                  <input type="checkbox" name="colsSueldos" value={columna.id} defaultChecked={setColumnasLiquidaciones.has(columna.id)} />
                  {columna.etiqueta}
                </label>
              ))}
            </div>
            <button className="ghost-button" type="submit">Aplicar columnas</button>
          </form>
        </details>

        {liquidaciones.length ? (
          <div className="cont-tabla-scroll">
            <table className="data-table embedded-table cont-sueldos-tabla cont-liquidaciones-tabla">
              <thead>
                <tr>
                  {setColumnasLiquidaciones.has("persona") ? encabezadoLiquidacion("Persona", "persona") : null}
                  {setColumnasLiquidaciones.has("dias") ? encabezadoLiquidacion("Días", "dias") : null}
                  {setColumnasLiquidaciones.has("salidas") ? encabezadoLiquidacion("Salidas", "salidas") : null}
                  {setColumnasLiquidaciones.has("horas") ? encabezadoLiquidacion("Horas", "horas") : null}
                  {setColumnasLiquidaciones.has("sueldo") ? encabezadoLiquidacion("Sueldo", "sueldo") : null}
                  {setColumnasLiquidaciones.has("pagado") ? encabezadoLiquidacion("Pagado", "pagado") : null}
                  {setColumnasLiquidaciones.has("falta") ? encabezadoLiquidacion("Falta", "falta") : null}
                  {setColumnasLiquidaciones.has("estado") ? encabezadoLiquidacion("Estado", "estado") : null}
                  <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {paginaLiquidaciones.items.map((fila) => (
                  <tr key={fila.userId} data-estado={fila.estado}>
                    {setColumnasLiquidaciones.has("persona") ? (
                      <td data-label="Persona">
                        <Link href={fila.rol === "DRIVER" ? `/admin/contabilidad/choferes?chofer=${fila.userId}&month=${mes}` : fichaDe(fila)}>{fila.nombre}</Link>
                        <small>{fila.rol === "DRIVER" ? "Chofer" : "Secretaria"}{fila.activo ? "" : " · inactivo"}</small>
                      </td>
                    ) : null}
                    {setColumnasLiquidaciones.has("dias") ? (
                      <td data-label="Días" className="cont-num">{fila.base ? <strong>{fila.base.dias}</strong> : <span className="muted">—</span>}</td>
                    ) : null}
                    {setColumnasLiquidaciones.has("salidas") ? (
                      <td data-label="Salidas" className="cont-num">{fila.base ? fila.base.salidas : <span className="muted">—</span>}</td>
                    ) : null}
                    {setColumnasLiquidaciones.has("horas") ? (
                      <td data-label="Horas" className="cont-num">{fila.base ? formatoHoras(fila.base.horas) : <span className="muted">—</span>}</td>
                    ) : null}
                    {setColumnasLiquidaciones.has("sueldo") ? (
                      <td data-label="Sueldo" className="cont-num">{fila.sueldoCents ? formatCurrency(fila.sueldoCents, fila.moneda) : <Link className="cont-falta-dato" href={fichaDe(fila)}>Cargar en la ficha</Link>}</td>
                    ) : null}
                    {setColumnasLiquidaciones.has("pagado") ? (
                      <td data-label="Pagado" className="cont-num">
                        {fila.pagadoCents ? formatCurrency(fila.pagadoCents, fila.moneda) : "—"}
                        {fila.pagosEnOtraMoneda.map((otro) => <small key={otro.currency}>+ {formatCurrency(otro.amountCents, otro.currency)} en otra moneda</small>)}
                      </td>
                    ) : null}
                    {setColumnasLiquidaciones.has("falta") ? (
                      <td data-label="Falta" className="cont-num"><strong>{fila.pendienteCents ? formatCurrency(fila.pendienteCents, fila.moneda) : fila.pendienteCents === 0 ? "—" : "?"}</strong></td>
                    ) : null}
                    {setColumnasLiquidaciones.has("estado") ? (
                      <td data-label="Estado"><span className="cont-estado" data-estado={fila.estado}>{ETIQUETA_ESTADO_SUELDO[fila.estado]}</span></td>
                    ) : null}
                    <td className="cont-accion">
                      {fila.activo ? pagoDe(fila, fila.estado === "pagado" || fila.estado === "de-mas" ? "Otro pago" : "Pagar") : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No hay choferes ni secretarias que coincidan con el filtro. Probá limpiar la búsqueda o cargar una ficha.</p>
        )}
        <Paginador
          page={paginaLiquidaciones.page}
          totalPages={paginaLiquidaciones.totalPages}
          total={paginaLiquidaciones.total}
          desde={paginaLiquidaciones.desde}
          hasta={paginaLiquidaciones.hasta}
          hrefPagina={(numero) => hrefDePagina(BASE, params, numero, "pageSueldos")}
          etiqueta="liquidaciones"
          pageSize={tamanoPagina}
          tamanos={TAMANOS_DE_PAGINA}
          hrefTamano={hrefTamano}
        />
      </section>
      ) : null}

      {seccion === "egresos" ? (
      <section className="plain-card admin-section" id="egresos" aria-labelledby="cont-egresos-titulo">
        <header className="cont-seccion-cabeza">
          <div>
            <h2 id="cont-egresos-titulo">{soloCombustible ? "Combustible" : "Egresos"} de {mesLabel}</h2>
            <p className="muted">{egresos.length} {egresos.length === 1 ? "movimiento" : "movimientos"}</p>
          </div>
          <ChipsDeFiltro
            etiqueta="Tipo de egreso"
            actual={soloCombustible ? "combustible" : "todos"}
            filtros={[
              { id: "todos", etiqueta: "Todos", cuenta: report.expenses.length, href: hrefSeccion("egresos") },
              { id: "combustible", etiqueta: "Combustible", cuenta: cargas.length, href: `${hrefSeccion("egresos")}&gasto=combustible` }
            ]}
          />
        </header>
        {soloCombustible ? (
          <div className="cont-combustible cont-combustible-barra">
            <div>
              <h3>Por nave</h3>
              {navesDeCombustible.length ? (
                <ul role="list">
                  {navesDeCombustible.map((grupo, indice) => (
                    <li key={`${grupo.nave}-${grupo.moneda}-${indice}`}>
                      <span>{grupo.nave}</span>
                      <strong className="cont-num">{importeConMoneda(grupo.centavos, grupo.moneda)}</strong>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">Sin cargas de combustible en {mesLabel}.</p>}
            </div>
            <div className="cont-combustible-pie">
              {totalesCombustible.map((total) => (
                <strong key={total.moneda} className="cont-importe-combustible">{importeConMoneda(total.centavos, total.moneda)}</strong>
              ))}
              <NuevoEgreso combustible action={createExpenseAction} vehicles={vehicles} mes={mes} fecha={fechaSugerida} mesLabel={mesLabel} closeKey={modalKey} seccion={seccion} />
            </div>
          </div>
        ) : null}
        <div className="cont-tabla-scroll">
          <table className="data-table embedded-table cont-tabla-egresos">
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
                  <td data-label="Fecha" className="cont-c-fecha" title={formatDate(entry.occurredAt)}>{fechaCorta(entry.occurredAt)}</td>
                  <td data-label="Categoría" className="cont-c-categoria">{categoriaLabel(entry.category)}{entry.salaryPeriod ? <small className="muted"> · período {entry.salaryPeriod.split("-").reverse().join("/")}</small> : null}</td>
                  <td data-label="Monto" className="cont-num cont-c-monto">{entry.category === "FUEL" ? importeConMoneda(entry.amountCents, entry.currency) : formatCurrency(entry.amountCents, entry.currency)}</td>
                  <td data-label="Nave" className="cont-c-nave">{entry.vehicle?.name ?? <span className="muted">—</span>}</td>
                  <td data-label="Persona" className="cont-c-persona">{entry.user?.name ?? entry.user?.email ?? <span className="muted">—</span>}</td>
                  <td data-label="Nota" className="cont-c-nota">{entry.notes ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
              {egresos.length === 0 ? (
                <tr>
                  <td colSpan={6}>Todavía no hay {soloCombustible ? "gastos de combustible" : "egresos"} cargados en {mesLabel}.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Paginador {...pagina} hrefPagina={(n) => hrefDePagina(BASE, params, n)} etiqueta="egresos" />
      </section>
      ) : null}
    </AdminShell>
  );
}
