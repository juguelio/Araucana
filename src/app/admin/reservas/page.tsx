import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import type { AdminReservationRowDto } from "@/lib/booking/types";
import { diaEnArgentina } from "@/lib/airport/freshness";
import { countAdminReservations, listAdminReservations } from "@/lib/booking/repository";
import { formatShortCode } from "@/lib/booking/codes";
import { claveDeLugar } from "@/lib/booking/place-names";
import {
  ADMIN_RESERVATIONS_PAGE_SIZE,
  ADMIN_RESERVATIONS_PAGE_SIZES,
  adminReservationFiltersSchema,
  type AdminReservationFilters,
  type AdminReservationView
} from "@/lib/booking/admin-filters";
import { Paginador } from "@/components/admin-list/paginador";
import { CopiarVoucher } from "@/components/copiar-voucher";
import { absoluteUrl, voucherMessage, voucherPath, whatsappShareUrl } from "@/lib/booking/voucher";
import { siteOrigin } from "@/lib/site-origin";
import { approveDisabilityDocumentAction, rejectDisabilityDocumentAction, approveManualPaymentAction, rejectManualPaymentAction, manageReservationAction } from "./actions";
import { reservationRowClassName } from "./row-style";
import { RowModal } from "./row-modal";
import { MenuFila } from "@/components/admin-list/menu-fila";
import { estadoDeFila, etiquetaDeAccion, type EstadoDeFila } from "./estado-fila";
import { ComprobanteViewer, fechaDeSubida } from "./comprobante-viewer";
import { ReceiptUploadForm } from "./receipt-upload-form";
import "@/components/admin-list/pagination.css";
import "./reservas.css";
import { isAdminRole } from "@/lib/auth/roles";
import { receiptAccept, receiptFormatsHelp } from "@/lib/payments/receipt-validation";

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
    vista?: string;
  }>;
};

/** Pestañas del listado (20-nov): tres colas de trabajo y tres vistas por día de viaje. */
type Pestana = "pending-payment" | "receipt-pending" | "documentation-pending" | AdminReservationView;
const COLAS: Pestana[] = ["pending-payment", "receipt-pending", "documentation-pending"];

function formatTotal(reservation: Pick<AdminReservationRowDto, "currency" | "totalCents">) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: reservation.currency, maximumFractionDigits: 0 }).format(reservation.totalCents / 100);
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

/** Link de una pestaña: arranca de cero (sin búsqueda ni filtros) y conserva las filas por página. */
function pestanaHref(pestana: Pestana, pageSize?: string) {
  const query = new URLSearchParams();
  if (COLAS.includes(pestana)) query.set("payment", pestana);
  else if (pestana !== "proximas") query.set("vista", pestana);
  if (pageSize) query.set("pageSize", pageSize);
  const texto = query.toString();
  return texto ? `/admin/reservas?${texto}` : "/admin/reservas";
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

/** «San Martin de los Andes» ocupa media fila: en el listado alcanza con «San Martín». */
function lugarCorto(lugar: string) {
  return claveDeLugar(lugar) === "san martin de los andes" ? "San Martín" : lugar.trim();
}

function rutaCorta(route: string) {
  return route.split(" -> ").map(lugarCorto).join(" → ");
}

const diaSemana = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** «sáb 21 nov» (+ «Hoy» / «Mañana»), con el día calendario guardado como `YYYY-MM-DD`. */
function encabezadoDelDia(dia: string | null, hoy: string) {
  if (!dia) return { titulo: "Sin fecha de viaje", relativo: null };
  const fecha = new Date(`${dia}T00:00:00Z`);
  const titulo = diaSemana.format(fecha).replace(/\./g, "").replace(",", "");
  const manana = new Date(new Date(`${hoy}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const relativo = dia === hoy ? "Hoy" : dia === manana ? "Mañana" : dia < hoy ? "Ya viajó" : null;
  return { titulo, relativo };
}

function diaYHoraCortos(dia: string | null, hora: string | null) {
  if (!dia) return "";
  const titulo = diaSemana.format(new Date(`${dia}T00:00:00Z`)).replace(/\./g, "").replace(",", "");
  return hora ? `${titulo} ${hora}` : titulo;
}

/** Las reservas de la página, en grupos por día de viaje (ya vienen ordenadas por viaje). */
function agruparPorDia(reservas: AdminReservationRowDto[]) {
  const grupos: Array<{ dia: string | null; reservas: AdminReservationRowDto[] }> = [];
  for (const reserva of reservas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === reserva.travelDay) ultimo.reservas.push(reserva);
    else grupos.push({ dia: reserva.travelDay, reservas: [reserva] });
  }
  return grupos;
}

function lugares(reservation: AdminReservationRowDto) {
  if (reservation.bookingMode === "CHAPELCO") {
    return `${reservation.passengerCount} ${reservation.passengerCount === 1 ? "persona" : "personas"}${reservation.chapelcoAscentSlot ? ` · ${reservation.chapelcoAscentSlot}` : ""}`;
  }
  const cantidad = `${reservation.passengerCount} ${reservation.passengerCount === 1 ? "lugar" : "lugares"}`;
  return reservation.seatNumber ? `${cantidad} · asiento ${reservation.seatNumber}` : cantidad;
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
        <input name="receipt" type="file" accept={receiptAccept} />
      </label>
      <small className="muted">{receiptFormatsHelp} Queda guardado junto al pago.</small>
      <button className="button" type="submit">Registrar pago</button>
    </form>
  );
}

/** Ver el comprobante subido y validarlo o rechazarlo (no se valida sin haberlo mirado). */
function ValidarPagoForm({ reservation, listQuery }: { reservation: AdminReservationRowDto; listQuery: string }) {
  const detailPath = `/admin/reservas/${reservation.code}`;
  return (
    <form className="reservas-modal-form" action={approveManualPaymentAction}>
      <Ocultos code={reservation.code} listQuery={listQuery} />
      <ComprobanteViewer href={`${detailPath}/comprobante`} fileName={reservation.receiptFileName} subido={fechaDeSubida(reservation.receiptUploadedAt)} />
      <div className="reservas-modal-acciones">
        <button className="button" type="submit">Validar pago</button>
        <button className="ghost-button" formAction={rejectManualPaymentAction} type="submit">Rechazar comprobante</button>
      </div>
    </form>
  );
}

function RevisarDocumentacionForm({ reservation, listQuery }: { reservation: AdminReservationRowDto; listQuery: string }) {
  const detailPath = `/admin/reservas/${reservation.code}`;
  return (
    <form className="reservas-modal-form" action={approveDisabilityDocumentAction}>
      <Ocultos code={reservation.code} listQuery={listQuery} />
      <input type="hidden" name="receiptVersion" value={new Date(reservation.receiptUploadedAt!).toISOString()} />
      <Link className="table-link" href={`${detailPath}/comprobante`} target="_blank">Ver documentación</Link>
      <div className="reservas-modal-acciones">
        <button className="button" type="submit">Aprobar documentación</button>
        <button className="ghost-button" formAction={rejectDisabilityDocumentAction} type="submit">Rechazar documentación</button>
      </div>
    </form>
  );
}

function CancelarForm({ reservation, listQuery }: { reservation: AdminReservationRowDto; listQuery: string }) {
  return (
    <form className="reservas-modal-form" action={manageReservationAction}>
      <Ocultos code={reservation.code} listQuery={listQuery} />
      <input type="hidden" name="operation" value="cancel" />
      <label>Motivo de la cancelación<textarea name="reason" required minLength={3} maxLength={300} rows={2} /></label>
      <button className="danger-button" type="submit">Cancelar reserva</button>
    </form>
  );
}

/**
 * Todo lo del estado y el pago de una reserva en un solo modal (lo que antes eran los modales de
 * «Estado» y «Pago» de la tabla): se abre tocando la etiqueta de la fila.
 */
function EstadoYPagoModal({ reservation, estado, listQuery }: { reservation: AdminReservationRowDto; estado: EstadoDeFila; listQuery: string }) {
  const detailPath = `/admin/reservas/${reservation.code}`;
  const muestraPagoAprobado = estado.pagada && !estado.cancelada && estado.canViewReceipt;
  const tieneComprobanteAprobado = muestraPagoAprobado && reservation.hasReceipt;
  return (
    <RowModal
      triggerLabel={`${estado.etiqueta}. Ver estado y pago`}
      trigger={<span className="pill pill-estado pill-tabla" data-tono={estado.tono}>{estado.etiqueta}</span>}
      eyebrow="Estado y pago"
      title={estado.disabilityFare ? `${estado.etiqueta}` : `${estado.etiqueta} · ${formatTotal(reservation)}`}
      subtitle={`${reservation.passenger} · ${formatShortCode(reservation.shortCode)} · cargada por ${reservation.creatorLabel}`}
      modalClassName={estado.validaPagoManual || tieneComprobanteAprobado ? "reservas-modal-comprobante" : undefined}
    >
      {tieneComprobanteAprobado ? (
        <ComprobanteViewer href={`${detailPath}/comprobante`} fileName={reservation.receiptFileName} subido={fechaDeSubida(reservation.receiptUploadedAt)} />
      ) : muestraPagoAprobado ? (
        <p className="muted">Este pago no tiene un comprobante adjunto.</p>
      ) : null}
      {estado.validaPagoManual ? <ValidarPagoForm reservation={reservation} listQuery={listQuery} /> : null}
      {estado.revisaDocumentacion ? <RevisarDocumentacionForm reservation={reservation} listQuery={listQuery} /> : null}
      {/* Con comprobante subido la acción es validarlo: «Registrar pago» ahí confunde. */}
      {estado.puedeRegistrarPago && !estado.validaPagoManual ? <RegistrarPagoForm reservation={reservation} listQuery={listQuery} /> : null}
      {reservation.status === "PENDING_PAYMENT" && !estado.disabilityFare ? (
        <form className="reservas-modal-form" action={manageReservationAction}>
          <Ocultos code={reservation.code} listQuery={listQuery} />
          <input type="hidden" name="operation" value="confirm" />
          <button className="button" type="submit" disabled={!estado.pagada && reservation.totalCents > 0}>Confirmar reserva</button>
          {estado.pagada ? (
            <small className="muted">El pago ya está registrado: este paso confirma la reserva y habilita el voucher para enviarle al pasajero.</small>
          ) : reservation.totalCents > 0 ? (
            <small className="muted">Se confirma cuando el pago está registrado o validado.</small>
          ) : null}
        </form>
      ) : null}
      {!estado.validaPagoManual && !estado.revisaDocumentacion && !estado.puedeRegistrarPago && reservation.status !== "PENDING_PAYMENT" ? (
        <p className="muted">
          {estado.pagada ? "El pago está aprobado. Para corregir la forma de pago o el precio, editá la reserva." : "No hay acciones de pago disponibles para esta reserva."}
        </p>
      ) : null}
      {!estado.cancelada ? (
        <CancelarForm reservation={reservation} listQuery={listQuery} />
      ) : (
        <form className="reservas-modal-form" action={manageReservationAction}>
          <Ocultos code={reservation.code} listQuery={listQuery} />
          <input type="hidden" name="operation" value="restore" />
          <button className="button" type="submit">Restituir reserva</button>
        </form>
      )}
      <Link className="ghost-button" href={`${detailPath}/editar`}>Editar reserva</Link>
    </RowModal>
  );
}

function FilaDeReserva({
  reservation,
  esAdmin,
  hoy,
  listQuery,
  origen
}: {
  reservation: AdminReservationRowDto;
  esAdmin: boolean;
  hoy: string;
  listQuery: string;
  origen: string;
}) {
  const estado = estadoDeFila(reservation, { esAdmin });
  const detailPath = `/admin/reservas/${reservation.code}`;
  const codigo = formatShortCode(reservation.shortCode);
  const subtitulo = `${reservation.passenger} · ${codigo}`;
  const voucherUrl = absoluteUrl(voucherPath(reservation.code), origen);
  const whatsappUrl = whatsappShareUrl(
    reservation.passengerPhone,
    voucherMessage({ firstName: reservation.passenger.split(" ")[0], shortCode: codigo, url: voucherUrl })
  );
  const companero = reservation.roundTripPartner;
  const conComprobante = estado.puedeSubirComprobante || (reservation.hasReceipt && estado.canViewReceipt);
  const pideAtencion = estado.accion === "validar-pago" || estado.accion === "aprobar-documentacion";
  const accion = etiquetaDeAccion(estado.accion);

  return (
    <li className={`reservas-fila ${reservationRowClassName(reservation.status) ?? ""}`} data-atencion={pideAtencion || undefined}>
      <span className="reservas-fila-hora">{reservation.travelTime ?? (reservation.bookingMode === "CHAPELCO" ? "Chapelco" : "—")}</span>
      <div className="reservas-fila-viaje">
        <span className="reservas-fila-ruta">{rutaCorta(reservation.route)}</span>
        <span className="reservas-fila-extra">
          {reservation.flightNumber ? <span>Vuelo {reservation.flightNumber}</span> : null}
          {companero ? (
            <Link className="reservas-tramo" href={`/admin/reservas/${companero.code}`} title={companero.isReturn ? "Ver la vuelta de este viaje" : "Ver la ida de este viaje"}>
              ⇄ {companero.isReturn ? "Vuelta" : "Ida"} {diaYHoraCortos(companero.travelDay, companero.travelTime)}
            </Link>
          ) : null}
        </span>
      </div>
      <div className="reservas-fila-pasajero">
        <Link className="reservas-fila-nombre" href={detailPath} title="Ver la reserva">{reservation.passenger}</Link>
        <span className="reservas-fila-extra">
          <span className="reservas-fila-codigo">{codigo}</span>
          <span>{lugares(reservation)}</span>
          {faltaDocumento(reservation, hoy) ? (
            <span className="pill pill-estado pill-tabla" data-tono="atencion" title="Se cargó sin DNI: se completa desde «Editar reserva».">Falta documento</span>
          ) : null}
        </span>
      </div>
      <div className="reservas-fila-estado">
        <EstadoYPagoModal reservation={reservation} estado={estado} listQuery={listQuery} />
        {estado.disabilityFare ? null : <span className="reservas-fila-total">{formatTotal(reservation)}</span>}
      </div>
      <div className="reservas-fila-accion">
        {estado.accion === "validar-pago" ? (
          <RowModal triggerLabel="Validar pago" triggerClassName="button table-action" trigger={accion} eyebrow="Comprobante de pago" title={formatTotal(reservation)} subtitle={subtitulo} modalClassName="reservas-modal-comprobante">
            <ValidarPagoForm reservation={reservation} listQuery={listQuery} />
          </RowModal>
        ) : estado.accion === "aprobar-documentacion" ? (
          <RowModal triggerLabel="Revisar documentación" triggerClassName="button table-action" trigger={accion} eyebrow="Documentación" title="Tarifa sin cargo" subtitle={subtitulo}>
            <RevisarDocumentacionForm reservation={reservation} listQuery={listQuery} />
          </RowModal>
        ) : estado.accion === "registrar-pago" ? (
          <RowModal triggerLabel="Registrar pago" triggerClassName="button table-action" trigger={accion} eyebrow="Registrar pago" title={formatTotal(reservation)} subtitle={subtitulo}>
            <RegistrarPagoForm reservation={reservation} listQuery={listQuery} />
          </RowModal>
        ) : estado.accion === "confirmar" ? (
          <form action={manageReservationAction}>
            <Ocultos code={reservation.code} listQuery={listQuery} />
            <input type="hidden" name="operation" value="confirm" />
            <button className="button table-action" type="submit" title="El pago ya está registrado: confirma la reserva y habilita el voucher.">{accion}</button>
          </form>
        ) : estado.accion === "whatsapp" && whatsappUrl ? (
          <a
            className="ghost-button table-action reservas-whatsapp"
            href={whatsappUrl}
            rel="noopener noreferrer"
            target="_blank"
            title={`Enviar el voucher por WhatsApp a ${reservation.passenger}`}
            aria-label={`Enviar el voucher por WhatsApp a ${reservation.passenger}`}
          >
            WhatsApp
          </a>
        ) : null}
      </div>
      <div className="reservas-fila-menu">
        <MenuFila etiqueta={`Más opciones de ${subtitulo}`}>
          <Link className="menu-fila-item" href={detailPath}>Ver reserva</Link>
          <Link className="menu-fila-item" href={`${detailPath}/editar`}>Editar reserva</Link>
          {whatsappUrl && estado.accion !== "whatsapp" ? (
            <a className="menu-fila-item" href={whatsappUrl} rel="noopener noreferrer" target="_blank">Enviar voucher por WhatsApp</a>
          ) : null}
          {!whatsappUrl ? <span className="menu-fila-nota">Sin teléfono para WhatsApp</span> : null}
          <span className="menu-fila-copiar" data-mantener>
            <CopiarVoucher url={voucherUrl} />
          </span>
          {conComprobante ? (
            <RowModal
              triggerLabel={reservation.hasReceipt && estado.canViewReceipt ? "Ver comprobante" : "Subir comprobante"}
              triggerClassName="menu-fila-item"
              trigger={reservation.hasReceipt && estado.canViewReceipt ? "Ver comprobante" : "Subir comprobante"}
              eyebrow="Comprobante"
              title={reservation.hasReceipt ? (reservation.receiptFileName ?? "Comprobante cargado") : "Sin comprobante"}
              subtitle={subtitulo}
              modalClassName="reservas-modal-comprobante"
            >
              {reservation.hasReceipt && estado.canViewReceipt ? (
                <ComprobanteViewer href={`${detailPath}/comprobante`} fileName={reservation.receiptFileName} subido={fechaDeSubida(reservation.receiptUploadedAt)} />
              ) : null}
              {estado.puedeSubirComprobante ? (
                <ReceiptUploadForm code={reservation.code} replace={reservation.hasReceipt} />
              ) : (
                <p className="muted">El pago ya no admite un comprobante nuevo.</p>
              )}
            </RowModal>
          ) : null}
          {!estado.cancelada ? (
            <RowModal triggerLabel="Cancelar reserva" triggerClassName="menu-fila-item menu-fila-peligro" trigger="Cancelar reserva" eyebrow="Cancelar reserva" title={subtitulo} subtitle={rutaCorta(reservation.route)}>
              <CancelarForm reservation={reservation} listQuery={listQuery} />
            </RowModal>
          ) : (
            <form action={manageReservationAction}>
              <Ocultos code={reservation.code} listQuery={listQuery} />
              <input type="hidden" name="operation" value="restore" />
              <button className="menu-fila-item" type="submit">Restituir reserva</button>
            </form>
          )}
        </MenuFila>
      </div>
    </li>
  );
}

export default async function AdminReservationsPage({ searchParams }: AdminReservationsPageProps) {
  const user = await getCurrentReservationsUserOrRedirect();
  const esAdmin = isAdminRole(user.role);
  const params = await searchParams;
  const parsed = adminReservationFiltersSchema.safeParse(params ?? {});
  const filtros = (params ?? {}) as Record<string, string | undefined>;

  // Pestaña activa: una cola de cobro (`payment`), o una vista por día. Sin nada elegido abre en
  // «Próximas» (los que viajan de hoy en adelante); con una búsqueda o un filtro, en «Todas».
  const cola = parsed.success && parsed.data.payment && COLAS.includes(parsed.data.payment as Pestana) ? (parsed.data.payment as Pestana) : null;
  const hayFiltros = ["q", "code", "date", "until", "route", "scheduleId", "payment"].some((clave) => Boolean(filtros[clave]));
  const vista: AdminReservationView = (parsed.success ? parsed.data.vista : undefined) ?? (hayFiltros ? "todas" : "proximas");
  const pestana: Pestana = cola ?? vista;
  // Las colas y los próximos viajes, del más cercano al más lejano; «Todas», del más nuevo al más viejo.
  const direccion = pestana === "todas" ? "desc" : "asc";
  const consulta: AdminReservationFilters | null = parsed.success ? { ...parsed.data, vista, orden: "viaje", dir: direccion } : null;

  const [pagina, porCobrar, comprobantes, documentacion, hoyCuenta, proximas] = await Promise.all([
    consulta
      ? listAdminReservations(consulta)
      : Promise.resolve({ items: [] as AdminReservationRowDto[], total: 0, page: 1, pageSize: ADMIN_RESERVATIONS_PAGE_SIZE, totalPages: 1 }),
    countAdminReservations({ payment: "pending-payment" }),
    countAdminReservations({ payment: "receipt-pending" }),
    esAdmin ? countAdminReservations({ payment: "documentation-pending" }) : Promise.resolve(0),
    countAdminReservations({ vista: "hoy" }),
    countAdminReservations({ vista: "proximas" })
  ]);
  const { items: reservations, total, page, pageSize, totalPages } = pagina;
  const hoy = diaEnArgentina();
  const desde = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const hasta = Math.min(page * pageSize, total);
  const listQuery = paginaHref(page, filtros).split("?")[1];
  // El voucher se comparte fuera de la app, así que el link del mensaje tiene que ser absoluto (#243).
  const origen = await siteOrigin();
  const masFiltrosActivos = ["date", "until", "route", "scheduleId", "code"].some((clave) => Boolean(filtros[clave])) || filtros.payment === "rejected";

  const pestanas: Array<{ id: Pestana; etiqueta: string; cuenta: number | null; alerta?: boolean }> = [
    { id: "pending-payment", etiqueta: "Por cobrar", cuenta: porCobrar },
    { id: "receipt-pending", etiqueta: "Por validar", cuenta: comprobantes, alerta: comprobantes > 0 },
    ...(esAdmin && (documentacion > 0 || pestana === "documentation-pending")
      ? [{ id: "documentation-pending" as Pestana, etiqueta: "Documentación", cuenta: documentacion, alerta: documentacion > 0 }]
      : []),
    { id: "hoy", etiqueta: "Hoy", cuenta: hoyCuenta },
    { id: "proximas", etiqueta: "Próximas", cuenta: proximas },
    { id: "todas", etiqueta: "Todas", cuenta: null }
  ];

  return (
    <AdminShell title="Reservas" notice={params?.notice} role={user.role}>
      <div className="reservas-cabecera">
        <form action="/admin/reservas" method="get" className="reservas-buscar" role="search">
          {params?.pageSize ? <input type="hidden" name="pageSize" value={params.pageSize} /> : null}
          <label className="sr-only" htmlFor="reservas-q">Buscar reserva</label>
          <input id="reservas-q" name="q" type="search" defaultValue={params?.q} maxLength={100} placeholder="Buscar: apellido, DNI, teléfono o código" />
          <button className="button" type="submit">Buscar</button>
        </form>
        <Link className="button reservas-nueva" href="/admin/reservas/nueva">Reservar</Link>
      </div>

      <nav className="reservas-pestanas" aria-label="Vistas de reservas">
        {pestanas.map((item) => (
          <Link
            key={item.id}
            className="reservas-pestana"
            href={pestanaHref(item.id, params?.pageSize)}
            aria-current={pestana === item.id && !filtros.q ? "page" : undefined}
            data-alerta={item.alerta || undefined}
          >
            {item.etiqueta}
            {item.cuenta !== null ? <span className="reservas-pestana-cuenta">{item.cuenta}</span> : null}
          </Link>
        ))}
      </nav>

      <details className="reservas-mas-filtros" open={masFiltrosActivos}>
        <summary>Más filtros{masFiltrosActivos ? <span className="reservas-filters-activos">activos</span> : null}</summary>
        <form action="/admin/reservas" method="get" className="reservas-filter-grid">
          {params?.pageSize ? <input type="hidden" name="pageSize" value={params.pageSize} /> : null}
          {params?.q ? <input type="hidden" name="q" value={params.q} /> : null}
          {parsed.success && parsed.data.vista ? <input type="hidden" name="vista" value={parsed.data.vista} /> : null}
          {params?.scheduleId ? <input type="hidden" name="scheduleId" value={params.scheduleId} /> : null}
          {params?.code ? <input type="hidden" name="code" value={params.code} /> : null}
          <label>Viaja desde el<input type="date" name="date" defaultValue={params?.date} /></label>
          <label>Hasta el<input type="date" name="until" defaultValue={params?.until} /></label>
          <label>Ruta o lugar<input name="route" defaultValue={params?.route} maxLength={100} placeholder="Traful, Hua Hum, Aeropuerto…" /></label>
          <label>
            Pago
            <select name="payment" defaultValue={params?.payment ?? ""}>
              <option value="">Todos</option>
              <option value="pending-payment">Por cobrar</option>
              <option value="receipt-pending">Comprobante por validar</option>
              {esAdmin && <option value="documentation-pending">Documentación por revisar</option>}
              <option value="rejected">Comprobante rechazado</option>
            </select>
          </label>
          <div className="reservas-filter-actions">
            <button className="button" type="submit">Aplicar</button>
            <Link href="/admin/reservas">Limpiar</Link>
          </div>
        </form>
      </details>

      {!parsed.success ? <p className="error" role="alert">Revisá los filtros: ingresá una fecha válida y textos de hasta 100 caracteres.</p> : null}
      <p className="reservas-resumen" role="status">
        {filtros.q ? <>Resultados para «{filtros.q}» · </> : null}
        {total === 0
          ? "No hay reservas para mostrar."
          : `${total} ${total === 1 ? "reserva" : "reservas"}${total > pageSize ? ` · página ${page} de ${totalPages}` : ""}`}
        {filtros.q || masFiltrosActivos ? <> · <Link href={pestanaHref("proximas", params?.pageSize)}>Volver a próximas</Link></> : null}
      </p>

      {agruparPorDia(reservations).map((grupo, indice) => {
        const { titulo, relativo } = encabezadoDelDia(grupo.dia, hoy);
        return (
          <section className="reservas-dia" key={`${grupo.dia ?? "sin-fecha"}-${indice}`} aria-label={titulo}>
            <h2 className="reservas-dia-titulo">
              <span>{titulo}</span>
              {relativo ? <span className="reservas-dia-relativo" data-hoy={relativo === "Hoy" || undefined}>{relativo}</span> : null}
            </h2>
            <ul className="reservas-lista">
              {grupo.reservas.map((reservation) => (
                <FilaDeReserva key={reservation.code} reservation={reservation} esAdmin={esAdmin} hoy={hoy} listQuery={listQuery} origen={origen} />
              ))}
            </ul>
          </section>
        );
      })}

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
