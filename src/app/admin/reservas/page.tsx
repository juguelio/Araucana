import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { listAdminReservations } from "@/lib/booking/repository";
import { ADMIN_RESERVATIONS_PAGE_SIZE, adminReservationFiltersSchema } from "@/lib/booking/admin-filters";
import { approveManualPaymentAction, rejectManualPaymentAction } from "./actions";
import "./pagination.css";

type AdminReservationsPageProps = {
  searchParams?: Promise<{
    notice?: string;
    code?: string;
    date?: string;
    route?: string;
    scheduleId?: string;
    page?: string;
    payment?: string;
  }>;
};

function formatReservationStatus(status: string) {
  const labels: Record<string, string> = {
    CONFIRMED: "Confirmada",
    PENDING_PAYMENT: "Pago pendiente",
    DOCUMENTATION_PENDING: "Docs pendientes",
    CANCELLED: "Cancelada"
  };

  return labels[status] ?? status;
}

function formatPaymentStatus(status: string | null) {
  if (!status) {
    return "-";
  }

  const labels: Record<string, string> = {
    APPROVED: "Aprobado",
    PENDING: "Pendiente",
    REJECTED: "Rechazado"
  };

  return labels[status] ?? status;
}

function whatsappHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

/** Link de página que arrastra los filtros activos (menos `notice`, que es un mensaje de una acción). */
function paginaHref(destino: number, params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (valor && clave !== "notice") query.set(clave, valor);
  }
  query.set("page", String(destino));
  return `/admin/reservas?${query.toString()}`;
}

export default async function AdminReservationsPage({ searchParams }: AdminReservationsPageProps) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const parsed = adminReservationFiltersSchema.safeParse(params ?? {});
  const pagina = parsed.success
    ? await listAdminReservations(parsed.data)
    : { items: [], total: 0, page: 1, pageSize: ADMIN_RESERVATIONS_PAGE_SIZE, totalPages: 1 };
  const { items: reservations, total, page, pageSize, totalPages } = pagina;
  const desde = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const hasta = Math.min(page * pageSize, total);
  const filtros = (params ?? {}) as Record<string, string | undefined>;

  return (
    <AdminShell title="Reservas" notice={params?.notice} role={user.role}>
      <div className="admin-page-actions">
        <Link className="button" href="/admin/reservas/nueva">Crear reserva</Link>
      </div>
      <form action="/admin/reservas" method="get" className="admin-form">
        <label>Código de reserva<input name="code" defaultValue={params?.code} maxLength={100} /></label>
        <label>Fecha del viaje<input type="date" name="date" defaultValue={params?.date} /></label>
        <label>Ruta (origen, destino o identificador)<input name="route" defaultValue={params?.route} maxLength={100} /></label>
        <label>ID de salida<input name="scheduleId" defaultValue={params?.scheduleId} maxLength={100} /></label>
        <label>
          Pago
          <select name="payment" defaultValue={params?.payment ?? ""}>
            <option value="">Todos</option>
            <option value="receipt-pending">Comprobante por validar</option>
            <option value="rejected">Comprobante rechazado</option>
          </select>
        </label>
        <button className="button" type="submit">Buscar reservas</button>
        <Link href="/admin/reservas">Limpiar filtros</Link>
      </form>
      {!parsed.success ? <p className="error" role="alert">Revisá los filtros: ingresá una fecha válida y textos de hasta 100 caracteres.</p> : null}
      {parsed.success && reservations.length === 0 ? <p role="status">No se encontraron reservas con esos filtros.</p> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th>Codigo</th>
            <th>Pasajero</th>
            <th>WhatsApp</th>
            <th>Ruta</th>
            <th>Asiento</th>
            <th>Estado</th>
            <th>Pago</th>
            <th>Comprobante</th>
            <th>Accion</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((reservation) => {
            const whatsappUrl = whatsappHref(reservation.passengerPhone);

            return (
              <tr key={reservation.code}>
                <td>{reservation.code}</td>
                <td>
                  <Link className="table-link" href={`/admin/reservas/${reservation.code}`}>
                    {reservation.passenger}
                  </Link>
                </td>
                <td>
                  {whatsappUrl ? (
                    <a
                      aria-label={`Enviar WhatsApp a ${reservation.passenger}`}
                      className="whatsapp-link"
                      href={whatsappUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                      title={`Enviar WhatsApp a ${reservation.passenger}`}
                    >
                      W
                    </a>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
                <td>{reservation.route}</td>
                <td>
                  {reservation.bookingMode === "CHAPELCO"
                    ? `${reservation.passengerCount} personas${reservation.chapelcoAscentSlot ? ` · ${reservation.chapelcoAscentSlot}` : ""}`
                    : `${reservation.passengerCount} ${reservation.passengerCount === 1 ? "lugar" : "lugares"}`}
                </td>
                <td>{formatReservationStatus(reservation.status)}</td>
                <td>{formatPaymentStatus(reservation.paymentStatus)}</td>
                <td>
                  {reservation.hasReceipt ? (
                    <Link className="table-link" href={`/admin/reservas/${reservation.code}/comprobante`} target="_blank">
                      {reservation.receiptFileName ?? "Ver comprobante"}
                    </Link>
                  ) : (
                    <span className="muted">Pendiente</span>
                  )}
                </td>
                <td>
                  {reservation.hasReceipt && reservation.status === "PENDING_PAYMENT" && reservation.paymentStatus === "PENDING" ? (
                    <form action={approveManualPaymentAction}>
                      <input type="hidden" name="code" value={reservation.code} />
                      <button className="button table-action" type="submit">
                        Validar pago
                      </button>
                      <button className="button table-action" formAction={rejectManualPaymentAction} type="submit">Rechazar comprobante</button>
                    </form>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {total > 0 ? (
        <nav className="pagination" aria-label="Paginación de reservas">
          {page > 1 ? (
            <Link className="pagination-link" href={paginaHref(page - 1, filtros)} rel="prev">
              ← Anterior
            </Link>
          ) : (
            <span aria-disabled="true" className="pagination-link">
              ← Anterior
            </span>
          )}
          <span className="pagination-status">
            Mostrando {desde}–{hasta} de {total} · página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link className="pagination-link" href={paginaHref(page + 1, filtros)} rel="next">
              Siguiente →
            </Link>
          ) : (
            <span aria-disabled="true" className="pagination-link">
              Siguiente →
            </span>
          )}
        </nav>
      ) : null}
    </AdminShell>
  );
}
