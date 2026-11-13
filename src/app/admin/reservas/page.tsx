import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { DISABILITY_DOCUMENT_PROVIDER, DISABILITY_PENDING_STATUS } from "@/lib/booking/disability-fare";
import { listAdminReservations } from "@/lib/booking/repository";
import { formatShortCode } from "@/lib/booking/codes";
import { ADMIN_RESERVATIONS_PAGE_SIZE, adminReservationFiltersSchema, formatTravelDay } from "@/lib/booking/admin-filters";
import { approveDisabilityDocumentAction, rejectDisabilityDocumentAction, approveManualPaymentAction, rejectManualPaymentAction, manageReservationAction } from "./actions";
import { ConfirmReservationButton } from "./[code]/confirm-reservation-button";
import { reservationRowClassName } from "./row-style";
import "./pagination.css";
import "./reservas.css";

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
  const listQuery = paginaHref(page, filtros).split("?")[1];

  return (
    <AdminShell title="Reservas" notice={params?.notice} role={user.role}>
      <div className="reservas-toolbar">
        <p>
          {total === 0
            ? "Sin reservas para estos filtros."
            : `${total} ${total === 1 ? "reserva" : "reservas"}${total > pageSize ? ` · página ${page} de ${totalPages}` : ""}`}
        </p>
        <Link className="button" href="/admin/reservas/nueva">Crear reserva</Link>
      </div>
      <section className="reservas-filters">
        <form action="/admin/reservas" method="get" className="reservas-filter-grid">
          <label>Código de reserva<input name="code" defaultValue={params?.code} maxLength={100} placeholder="Largo del link o corto" /></label>
          <label>Fecha del viaje<input type="date" name="date" defaultValue={params?.date} /></label>
          <label>Ruta (origen, destino o identificador)<input name="route" defaultValue={params?.route} maxLength={100} /></label>
          <label>ID de salida<input name="scheduleId" defaultValue={params?.scheduleId} maxLength={100} /></label>
          <label>
            Pago
            <select name="payment" defaultValue={params?.payment ?? ""}>
              <option value="">Todos</option>
              <option value="receipt-pending">Comprobante de pago por validar</option>
              {user.role === "ADMIN" && <option value="documentation-pending">Documentación por revisar</option>}
              <option value="rejected">Comprobante rechazado</option>
            </select>
          </label>
          <div className="reservas-filter-actions">
            <button className="button" type="submit">Buscar reservas</button>
            <Link href="/admin/reservas">Limpiar filtros</Link>
          </div>
        </form>
      </section>
      {!parsed.success ? <p className="error" role="alert">Revisá los filtros: ingresá una fecha válida y textos de hasta 100 caracteres.</p> : null}
      {parsed.success && reservations.length === 0 ? <p role="status">No se encontraron reservas con esos filtros.</p> : null}
      <div className="reservas-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Pasajero</th>
              <th>Creada por</th>
              <th>WhatsApp</th>
              <th>Ruta</th>
              <th>Fecha del viaje</th>
              <th>Asiento</th>
              <th>Estado</th>
              <th>Pago</th>
              <th>Comprobante</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((reservation) => {
              const disabilityFare = reservation.paymentProvider === DISABILITY_DOCUMENT_PROVIDER;
              const canViewReceipt = !disabilityFare || user.role === "ADMIN";
              const whatsappUrl = whatsappHref(reservation.passengerPhone);
              const detailPath = `/admin/reservas/${reservation.code}`;
              const canDelete = user.role === "ADMIN" && (reservation.paymentStatus !== "APPROVED" || disabilityFare);

              return (
                <tr key={reservation.code} className={reservationRowClassName(reservation.status)}>
                  <td className="reservas-code">
                    <span className="reservas-short-code">{formatShortCode(reservation.shortCode)}</span>
                    <span className="reservas-long-code">{reservation.code}</span>
                  </td>
                  <td>
                    <Link className="table-link" href={detailPath}>
                      {reservation.passenger}
                    </Link>
                  </td>
                  <td>{reservation.creatorLabel}</td>
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
                  <td>
                    {reservation.route}
                    {reservation.flightNumber ? <div className="muted">Vuelo {reservation.flightNumber}</div> : null}
                  </td>
                  <td className="reservas-date">{formatTravelDay(reservation.travelDay)}</td>
                  <td>
                    {reservation.bookingMode === "CHAPELCO"
                      ? `${reservation.passengerCount} personas${reservation.chapelcoAscentSlot ? ` · ${reservation.chapelcoAscentSlot}` : ""}`
                      : `${reservation.passengerCount} ${reservation.passengerCount === 1 ? "lugar" : "lugares"}`}
                  </td>
                  <td>{formatReservationStatus(reservation.status)}</td>
                  <td>{disabilityFare ? "Sin cargo" : formatPaymentStatus(reservation.paymentStatus)}</td>
                  <td>
                    {reservation.hasReceipt && canViewReceipt ? (
                      <Link className="table-link" href={`/admin/reservas/${reservation.code}/comprobante`} target="_blank">
                        {reservation.receiptFileName ?? "Ver comprobante"}
                      </Link>
                    ) : (
                      <span className="muted">Pendiente</span>
                    )}
                  </td>
                  <td>
                    <form className="reservas-row-actions" action={manageReservationAction}>
                      <input type="hidden" name="code" value={reservation.code} />
                      <input type="hidden" name="listQuery" value={listQuery} />
                      <Link className="ghost-button table-action" href={detailPath}>Ver</Link>
                      <Link className="ghost-button table-action" href={`${detailPath}/editar`}>Editar</Link>
                      {reservation.status !== "CANCELLED" ? <ConfirmReservationButton operation="cancel" compact /> : null}
                      {canDelete ? <ConfirmReservationButton operation="delete" compact /> : null}
                    </form>
                    {disabilityFare && canViewReceipt && reservation.hasReceipt && reservation.status === DISABILITY_PENDING_STATUS && reservation.paymentStatus === "PENDING" && reservation.receiptUploadedAt ? (
                      <form className="reservas-actions" action={approveDisabilityDocumentAction}>
                        <input type="hidden" name="code" value={reservation.code} />
                        <input type="hidden" name="receiptVersion" value={new Date(reservation.receiptUploadedAt).toISOString()} />
                        <button className="button table-action" type="submit">Aprobar documentación</button>
                        <button className="ghost-button table-action" formAction={rejectDisabilityDocumentAction} type="submit">Rechazar documentación</button>
                      </form>
                    ) : !disabilityFare && reservation.hasReceipt && reservation.status === "PENDING_PAYMENT" && reservation.paymentStatus === "PENDING" ? (
                      <form className="reservas-actions" action={approveManualPaymentAction}>
                        <input type="hidden" name="code" value={reservation.code} />
                        <button className="button table-action" type="submit">
                          Validar pago
                        </button>
                        <button className="ghost-button table-action" formAction={rejectManualPaymentAction} title="Rechazar comprobante" type="submit">
                          Rechazar
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
