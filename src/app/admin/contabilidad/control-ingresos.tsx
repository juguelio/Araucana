import Link from "next/link";
import { Paginador } from "@/components/admin-list/paginador";
import { leerPagina, paginar } from "@/lib/admin/list-order";
import { INCOME_CHECK_LABELS, type AccountingIncomeItem } from "@/lib/accounting/types";

const amount = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function importe(cents: number, currency: string) {
  return amount.format(cents / 100) + " " + currency;
}

type Props = { ingresos: AccountingIncomeItem[]; mes: string; filtro?: string; pagina?: string };

export function ControlIngresos({ ingresos, mes, filtro, pagina }: Props) {
  const pendientes = ingresos.filter(item => item.check !== "matched");
  const todos = filtro === "todos";
  const filas = [...(todos ? ingresos : pendientes)].sort((a, b) =>
    b.occurredAt.getTime() - a.occurredAt.getTime() || a.code.localeCompare(b.code));
  const lista = paginar(filas, leerPagina(pagina), 15);
  function href(todos: boolean, page = 1) {
    const query = new URLSearchParams({ month: mes, control: todos ? "todos" : "revisar" });
    if (page > 1) query.set("ingresosPage", String(page));
    return "/admin/contabilidad?" + query + "#control-ingresos";
  }
  return <section className="plain-card admin-section" id="control-ingresos" aria-labelledby="control-titulo">
    <h2 id="control-titulo">Control de ingresos</h2>
    <p className="muted">Compará el valor de cada reserva incluida en el informe con el pago aprobado registrado en Araucana.</p>
    <nav className="cont-control-filtros" aria-label="Filtrar ingresos">
      <Link aria-current={!todos ? "page" : undefined} href={href(false)}>Para revisar ({pendientes.length})</Link>
      <Link aria-current={todos ? "page" : undefined} href={href(true)}>Todos ({ingresos.length})</Link>
      <Link href={"/admin/contabilidad/conciliacion?month=" + mes}>Cotejar con el banco</Link>
      <a href={"/admin/reportes/export?month=" + mes} download>Descargar Excel del mes</a>
    </nav>
    {lista.total ? <><div className="cont-tabla-scroll"><table className="data-table embedded-table"><thead><tr>
      <th>Reserva</th><th>Ingreso del informe</th><th>Pago aprobado</th><th>Control</th>
    </tr></thead><tbody>{lista.items.map(item => <tr key={item.id}>
      <td>{item.hasRoute ? <Link href={"/admin/reservas/" + encodeURIComponent(item.code)}>{item.code}</Link> : <>{item.code}<small> · Recorrido sin vincular</small></>}</td>
      <td className="cont-num">{importe(item.amountCents, item.currency)}</td>
      <td className="cont-num">{item.approvedPayment ? importe(item.approvedPayment.amountCents, item.approvedPayment.currency) : "—"}</td>
      <td>{INCOME_CHECK_LABELS[item.check]}</td>
    </tr>)}</tbody></table></div><Paginador {...lista} hrefPagina={n => href(todos, n)} etiqueta="ingresos" /></>
      : <p>{ingresos.length ? "Todos los ingresos del mes coinciden con un pago aprobado." : "Sin ingresos en el informe de este mes."}</p>}
  </section>;
}
