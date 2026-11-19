import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { DISABILITY_DOCUMENT_PROVIDER, DISABILITY_PENDING_STATUS, receiptPendingStatus } from "@/lib/booking/disability-fare";
import { canRegisterManualPayment } from "@/lib/booking/admin-price";
import type { AdminReservationRowDto } from "@/lib/booking/types";
import { diaEnArgentina } from "@/lib/airport/freshness";
import { listAdminReservations } from "@/lib/booking/repository";
import { formatShortCode } from "@/lib/booking/codes";
import { ADMIN_RESERVATIONS_PAGE_SIZE, ADMIN_RESERVATIONS_PAGE_SIZES, adminReservationFiltersSchema, formatTravelDay } from "@/lib/booking/admin-filters";
import { adminReservationOrder } from "@/lib/booking/admin-reservation-sort";
import { EncabezadoOrdenable, OrdenOculto } from "@/components/admin-list/encabezado-ordenable";
import { Paginador } from "@/components/admin-list/paginador";
import { CopiarVoucher } from "@/components/copiar-voucher";
import { absoluteUrl, voucherMessage, voucherPath, whatsappShareUrl } from "@/lib/booking/voucher";
import { siteOrigin } from "@/lib/site-origin";
import { approveDisabilityDocumentAction, rejectDisabilityDocumentAction, approveManualPaymentAction, rejectManualPaymentAction, manageReservationAction } from "./actions";
import { ConfirmReservationButton } from "./[code]/confirm-reservation-button";
import { reservationRowClassName } from "./row-style";
import { RowModal } from "./row-modal";
import { ReceiptUploadForm } from "./receipt-upload-form";
import "@/components/admin-list/pagination.css";
import "./reservas.css";
import { isAdminRole } from "@/lib/auth/roles";

type AdminReservationsPageProps = {
  searchParams?: Promise<{
    notice?: string;
    q?: string;
    code?: string;
    date?: string;
    until?: string;
    route?: string;
    scheduleId?: string;
    page?: string;
    pageSize?: string;
    payment?: string;
    orden?: string;
    dir?: string;
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

/** Tono de la etiqueta de estado: lo mismo que decía el texto, pero de un vistazo. */
function tonoEstado(status: string) {
  return status === "CONFIRMED" ? "ok" : status === "CANCELLED" ? "normal" : "atencion";
}

function tonoPago(status: string | null, disabilityFare: boolean) {
  if (disabilityFare) return "normal";
  return status === "APPROVED" ? "ok" : status === "REJECTED" ? "grave" : status === "PENDING" ? "atencion" : "normal";
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

/** Cambiar las filas por página conserva la búsqueda y vuelve a la primera página. */
function tamanoHref(tamano: number, params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (valor && clave !== "notice" && clave !== "page" && clave !== "pageSize") query.set(clave, valor);
  }
  query.set("pageSize", String(tamano));
  return `/admin/reservas?${query.toString()}`;
}

/**
 * El listado marca «Falta documento» sólo en los viajes de hoy en adelante (19-nov): las reservas
 * viejas sin DNI son historia, no algo para completar.
 */
function faltaDocumento(reservation: AdminReservationRowDto, hoy: string) {
  if (reservation.passengerDocumentId.trim()) return false;
  const dia = reservation.travelDay ?? diaEnArgentina(new Date(reservation.departureAt));
  return dia >= hoy;
}

function formatTotal(reservation: AdminReservationRowDto) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: reservation.currency }).format(reservation.totalCents / 100);
}

/** Datos ocultos que llevan todos los formularios de los modales: la reserva y el listado al que volver. */
function Ocultos({ code, listQuery }: { code: string; listQuery: string }) {
  return (
    <>
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="listQuery" value={listQuery} />
    </>
  );
}

/** Registrar un pago recibido (efectivo, transferencia…): el mismo formulario de `/pago`, en el modal. */
function RegistrarPagoForm({ reservation, listQuery }: { reservation: AdminReservationRowDto; listQuery: string }) {
  return (
    <form className="reservas-modal-form" action={manageReservationAction}>
      <Ocultos code={reservation.code} listQuery={listQuery} />
      <input type="hidden" name="operation" value="payment" />
      <p>Registrá el pago cuando hayas recibido el total de <strong>{formatTotal(reservation)}</strong>.</p>
      <label>Forma de pago<input name="method" maxLength={60} placeholder="Efectivo, transferencia, tarjeta…" /></label>
      <label>Referencia (opcional)<input name="reference" maxLength={120} /></label>
      <label>
        Comprobante (opcional)
        <input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" />
      </label>
      <small className="muted">PDF, JPG, PNG o WEBP. Queda guardado junto al pago.</small>
      <button className="button" type="submit">Registrar pago</button>
    </form>
  );
}

export default async function AdminReservationsPage({ searchParams }: AdminReservationsPageProps) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const parsed = adminReservationFiltersSchema.safeParse(params ?? {});
  const pagina = parsed.success
    ? await listAdminReservations(parsed.data)
    : { items: [], total: 0, page: 1, pageSize: ADMIN_RESERVATIONS_PAGE_SIZE, totalPages: 1 };
  const { items: reservations, total, page, pageSize, totalPages } = pagina;
  const hoy = diaEnArgentina();
  const desde = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const hasta = Math.min(page * pageSize, total);
  const filtros = (params ?? {}) as Record<string, string | undefined>;
  const listQuery = paginaHref(page, filtros).split("?")[1];
  const hayFiltros = ["q", "code", "date", "until", "route", "scheduleId", "payment"].some((clave) => Boolean(filtros[clave]));
  // Orden por columna (issue #192): la columna activa se lee de la URL y se sanea contra la lista blanca.
  const orden = adminReservationOrder(parsed.success ? parsed.data : {});
  // El voucher se comparte fuera de la app, así que el link del mensaje tiene que ser absoluto (#243).
  const origen = await siteOrigin();

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
        {/* En el celular los filtros se pliegan; la casilla (sin JS) recuerda si están abiertos. */}
        <input className="reservas-filters-toggle" id="reservas-filtros-toggle" type="checkbox" defaultChecked={hayFiltros} />
        <label className="reservas-filters-summary" htmlFor="reservas-filtros-toggle">
          Filtros{hayFiltros ? <span className="reservas-filters-activos">activos</span> : null}
        </label>
        <form action="/admin/reservas" method="get" className="reservas-filter-grid">
          {/* Filtrar no pierde el orden elegido ni las filas por página. */}
          <OrdenOculto orden={orden} />
          {params?.pageSize ? <input type="hidden" name="pageSize" value={params.pageSize} /> : null}
          <label className="reservas-filter-buscar">
            Buscar
            <input
              name="q"
              type="search"
              defaultValue={params?.q}
              maxLength={100}
              placeholder="Apellido, DNI, código, email o teléfono"
            />
          </label>
          <label>Código de reserva<input name="code" defaultValue={params?.code} maxLength={100} placeholder="Largo del link o corto" /></label>
          <label>Desde<input type="date" name="date" defaultValue={params?.date} /></label>
          <label>Hasta<input type="date" name="until" defaultValue={params?.until} /></label>
          <label>Ruta (origen, destino o identificador)<input name="route" defaultValue={params?.route} maxLength={100} /></label>
          <label>ID de salida<input name="scheduleId" defaultValue={params?.scheduleId} maxLength={100} /></label>
          <label>
            Pago
            <select name="payment" defaultValue={params?.payment ?? ""}>
              <option value="">Todos</option>
              <option value="receipt-pending">Comprobante de pago por validar</option>
              {isAdminRole(user.role) && <option value="documentation-pending">Documentación por revisar</option>}
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
              <EncabezadoOrdenable etiqueta="Código" columna="codigo" orden={orden} base="/admin/reservas" params={filtros} />
              <EncabezadoOrdenable etiqueta="Pasajero" columna="pasajero" orden={orden} base="/admin/reservas" params={filtros} />
              <EncabezadoOrdenable etiqueta="Creada por" columna="creadaPor" orden={orden} base="/admin/reservas" params={filtros} />
              <th>WhatsApp</th>
              <th>Ruta</th>
              <th>Fecha del viaje</th>
              <EncabezadoOrdenable etiqueta="Asiento" columna="asiento" orden={orden} base="/admin/reservas" params={filtros} />
              <EncabezadoOrdenable etiqueta="Estado" columna="estado" orden={orden} base="/admin/reservas" params={filtros} />
              <EncabezadoOrdenable etiqueta="Pago" columna="pago" orden={orden} base="/admin/reservas" params={filtros} />
              <th>Comprobante</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((reservation) => {
              const disabilityFare = reservation.paymentProvider === DISABILITY_DOCUMENT_PROVIDER;
              const canViewReceipt = !disabilityFare || isAdminRole(user.role);
              const voucherUrl = absoluteUrl(voucherPath(reservation.code), origen);
              const whatsappUrl = whatsappShareUrl(
                reservation.passengerPhone,
                voucherMessage({
                  firstName: reservation.passenger.split(" ")[0],
                  shortCode: formatShortCode(reservation.shortCode),
                  url: voucherUrl
                })
              );
              const detailPath = `/admin/reservas/${reservation.code}`;
              const porValidar = reservation.hasReceipt && canViewReceipt && reservation.paymentStatus === "PENDING" &&
                (disabilityFare ? reservation.status === DISABILITY_PENDING_STATUS : reservation.status === "PENDING_PAYMENT");
              const pago = reservation.paymentProvider && reservation.paymentStatus
                ? { provider: reservation.paymentProvider, status: reservation.paymentStatus }
                : null;
              const puedeRegistrarPago = canRegisterManualPayment(reservation.status, reservation.totalCents, pago);
              // Mismas reglas que el link del pasajero: el pago tiene que estar esperando comprobante.
              const puedeSubirComprobante = Boolean(pago) && reservation.status === receiptPendingStatus(reservation.paymentProvider) &&
                ["PENDING", "REJECTED"].includes(reservation.paymentStatus ?? "") && (!disabilityFare || isAdminRole(user.role));
              const validaPagoManual = !disabilityFare && reservation.hasReceipt && reservation.status === "PENDING_PAYMENT" && reservation.paymentStatus === "PENDING";
              const revisaDocumentacion = disabilityFare && canViewReceipt && reservation.hasReceipt && reservation.status === DISABILITY_PENDING_STATUS &&
                reservation.paymentStatus === "PENDING" && Boolean(reservation.receiptUploadedAt);
              const cancelada = reservation.status === "CANCELLED";
              const pagada = reservation.paymentStatus === "APPROVED" && !disabilityFare;
              const subtitulo = `${reservation.passenger} · ${formatShortCode(reservation.shortCode)}`;

              return (
                <tr key={reservation.code} className={reservationRowClassName(reservation.status)} data-por-validar={porValidar || undefined}>
                  <td className="reservas-code" data-label="Código">
                    <Link className="reservas-code-link" href={detailPath} title="Ver la reserva">
                      <span className="reservas-short-code">{formatShortCode(reservation.shortCode)}</span>
                      <span className="reservas-long-code">{reservation.code}</span>
                    </Link>
                  </td>
                  <td data-label="Pasajero">
                    <Link className="table-link" href={detailPath}>
                      {reservation.passenger}
                    </Link>
                    {faltaDocumento(reservation, hoy) ? (
                      <div>
                        <span className="pill pill-estado pill-tabla" data-tono="atencion" title="Se cargó sin DNI: se completa desde «Editar reserva».">Falta documento</span>
                      </div>
                    ) : null}
                  </td>
                  <td data-label="Creada por">{reservation.creatorLabel}</td>
                  <td data-label="WhatsApp">
                    <span className="reserva-compartir">
                      {whatsappUrl ? (
                        <a
                          aria-label={`Enviar el voucher por WhatsApp a ${reservation.passenger}`}
                          className="whatsapp-link"
                          href={whatsappUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                          title={`Enviar el voucher por WhatsApp a ${reservation.passenger}`}
                        >
                          W
                        </a>
                      ) : (
                        <span className="muted" title="La reserva no tiene teléfono cargado">-</span>
                      )}
                      <CopiarVoucher url={voucherUrl} />
                    </span>
                  </td>
                  <td data-label="Ruta">
                    {reservation.route}
                    {reservation.flightNumber ? <div className="muted">Vuelo {reservation.flightNumber}</div> : null}
                  </td>
                  <td className="reservas-date" data-label="Fecha del viaje">{formatTravelDay(reservation.travelDay)}</td>
                  <td data-label="Asiento">
                    {reservation.bookingMode === "CHAPELCO"
                      ? `${reservation.passengerCount} personas${reservation.chapelcoAscentSlot ? ` · ${reservation.chapelcoAscentSlot}` : ""}`
                      : `${reservation.passengerCount} ${reservation.passengerCount === 1 ? "lugar" : "lugares"}`}
                  </td>
                  <td data-label="Estado">
                    <RowModal
                      triggerLabel={`Estado de la reserva: ${formatReservationStatus(reservation.status)}. Cambiar estado`}
                      trigger={<span className="pill pill-estado pill-tabla" data-tono={tonoEstado(reservation.status)}>{formatReservationStatus(reservation.status)}</span>}
                      eyebrow="Estado de la reserva"
                      title={formatReservationStatus(reservation.status)}
                      subtitle={subtitulo}
                    >
                      {reservation.status === "PENDING_PAYMENT" && puedeRegistrarPago ? (
                        <RegistrarPagoForm reservation={reservation} listQuery={listQuery} />
                      ) : null}
                      {reservation.status === "PENDING_PAYMENT" && !disabilityFare ? (
                        <form className="reservas-modal-form" action={manageReservationAction}>
                          <Ocultos code={reservation.code} listQuery={listQuery} />
                          <input type="hidden" name="operation" value="confirm" />
                          <button className="button" type="submit" disabled={!pagada && reservation.totalCents > 0}>Confirmar reserva</button>
                          {!pagada && reservation.totalCents > 0 ? <small className="muted">Se confirma cuando el pago está registrado o validado.</small> : null}
                        </form>
                      ) : null}
                      {!cancelada ? (
                        <form className="reservas-modal-form" action={manageReservationAction}>
                          <Ocultos code={reservation.code} listQuery={listQuery} />
                          <input type="hidden" name="operation" value="cancel" />
                          <label>Motivo de la cancelación<textarea name="reason" required minLength={3} maxLength={300} rows={2} /></label>
                          <button className="danger-button" type="submit">Cancelar reserva</button>
                        </form>
                      ) : (
                        <form className="reservas-modal-form" action={manageReservationAction}>
                          <Ocultos code={reservation.code} listQuery={listQuery} />
                          <input type="hidden" name="operation" value="restore" />
                          <button className="button" type="submit">Restituir reserva</button>
                        </form>
                      )}
                      <Link className="ghost-button" href={`${detailPath}/editar`}>Editar reserva</Link>
                    </RowModal>
                  </td>
                  <td data-label="Pago">
                    <RowModal
                      triggerLabel={`Pago: ${disabilityFare ? "Sin cargo" : formatPaymentStatus(reservation.paymentStatus)}. Ver opciones de pago`}
                      trigger={
                        <span className="pill pill-estado pill-tabla" data-tono={tonoPago(reservation.paymentStatus, disabilityFare)}>
                          {disabilityFare ? "Sin cargo" : formatPaymentStatus(reservation.paymentStatus)}
                        </span>
                      }
                      eyebrow="Pago"
                      title={disabilityFare ? "Tarifa sin cargo" : `${formatPaymentStatus(reservation.paymentStatus)} · ${formatTotal(reservation)}`}
                      subtitle={subtitulo}
                    >
                      {validaPagoManual ? (
                        <form className="reservas-modal-form" action={approveManualPaymentAction}>
                          <input type="hidden" name="code" value={reservation.code} />
                          <p>El pasajero subió un comprobante: revisalo y validá o rechazá el pago.</p>
                          <Link className="table-link" href={`${detailPath}/comprobante`} target="_blank">Ver comprobante</Link>
                          <div className="reservas-modal-acciones">
                            <button className="button" type="submit">Validar pago</button>
                            <button className="ghost-button" formAction={rejectManualPaymentAction} type="submit">Rechazar comprobante</button>
                          </div>
                        </form>
                      ) : null}
                      {revisaDocumentacion ? (
                        <form className="reservas-modal-form" action={approveDisabilityDocumentAction}>
                          <input type="hidden" name="code" value={reservation.code} />
                          <input type="hidden" name="receiptVersion" value={new Date(reservation.receiptUploadedAt!).toISOString()} />
                          <Link className="table-link" href={`${detailPath}/comprobante`} target="_blank">Ver documentación</Link>
                          <div className="reservas-modal-acciones">
                            <button className="button" type="submit">Aprobar documentación</button>
                            <button className="ghost-button" formAction={rejectDisabilityDocumentAction} type="submit">Rechazar documentación</button>
                          </div>
                        </form>
                      ) : null}
                      {puedeRegistrarPago ? <RegistrarPagoForm reservation={reservation} listQuery={listQuery} /> : null}
                      {!validaPagoManual && !revisaDocumentacion && !puedeRegistrarPago ? (
                        <p className="muted">
                          {pagada ? "El pago está aprobado. Para corregir la forma de pago o el precio, editá la reserva." : "No hay acciones de pago disponibles para esta reserva."}
                        </p>
                      ) : null}
                      <Link className="ghost-button" href={`${detailPath}/editar`}>Editar reserva</Link>
                    </RowModal>
                  </td>
                  <td data-label="Comprobante">
                    {puedeSubirComprobante || (reservation.hasReceipt && canViewReceipt) ? (
                      <RowModal
                        triggerLabel={reservation.hasReceipt && canViewReceipt ? `Comprobante ${reservation.receiptFileName ?? ""}` : "Subir comprobante"}
                        triggerClassName="reservas-celda-boton reservas-celda-link"
                        trigger={reservation.hasReceipt && canViewReceipt ? (reservation.receiptFileName ?? "Ver comprobante") : "Subir comprobante"}
                        eyebrow="Comprobante"
                        title={reservation.hasReceipt ? (reservation.receiptFileName ?? "Comprobante cargado") : "Sin comprobante"}
                        subtitle={subtitulo}
                      >
                        {reservation.hasReceipt && canViewReceipt ? (
                          <Link className="ghost-button" href={`${detailPath}/comprobante`} target="_blank">Ver comprobante</Link>
                        ) : null}
                        {puedeSubirComprobante ? (
                          <ReceiptUploadForm code={reservation.code} replace={reservation.hasReceipt} />
                        ) : (
                          <p className="muted">El pago ya no admite un comprobante nuevo.</p>
                        )}
                      </RowModal>
                    ) : (
                      <span className="muted">{reservation.hasReceipt ? "Cargado" : "—"}</span>
                    )}
                  </td>
                  <td data-label="Acciones">
                    {/* «Ver» es el código de la reserva y «Borrar» está dentro de Editar. */}
                    <div className="reservas-row-actions">
                      <Link className="ghost-button table-action" href={`${detailPath}/editar`}>Editar</Link>
                      {puedeRegistrarPago ? (
                        <RowModal
                          triggerLabel="Registrar pago"
                          triggerClassName="button table-action"
                          trigger="Registrar pago"
                          eyebrow="Registrar pago"
                          title={formatTotal(reservation)}
                          subtitle={subtitulo}
                        >
                          <RegistrarPagoForm reservation={reservation} listQuery={listQuery} />
                        </RowModal>
                      ) : null}
                      {!cancelada ? (
                        <form action={manageReservationAction}>
                          <Ocultos code={reservation.code} listQuery={listQuery} />
                          <ConfirmReservationButton operation="cancel" compact />
                        </form>
                      ) : null}
                    </div>
                    {revisaDocumentacion ? (
                      <form className="reservas-actions" action={approveDisabilityDocumentAction}>
                        <input type="hidden" name="code" value={reservation.code} />
                        <input type="hidden" name="receiptVersion" value={new Date(reservation.receiptUploadedAt!).toISOString()} />
                        <button className="button table-action" type="submit">Aprobar documentación</button>
                        <button className="ghost-button table-action" formAction={rejectDisabilityDocumentAction} type="submit">Rechazar documentación</button>
                      </form>
                    ) : validaPagoManual ? (
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
      <Paginador
        page={page}
        totalPages={totalPages}
        total={total}
        desde={desde}
        hasta={hasta}
        hrefPagina={(numero) => paginaHref(numero, filtros)}
        etiqueta="reservas"
        pageSize={pageSize}
        tamanos={ADMIN_RESERVATIONS_PAGE_SIZES}
        hrefTamano={(filas) => tamanoHref(filas, filtros)}
      />
    </AdminShell>
  );
}
