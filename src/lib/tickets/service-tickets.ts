import { formatTicketNumber, parseTicketNumber, requiereBoletoNumerado, SERIE_WEB } from "./numbering";

export const ESTADO_EMITIDO = "EMITIDO";
export const ESTADO_ANULADO = "ANULADO";

export type ServiceTicketRecord = {
  id: string;
  series: string;
  number: number;
  displayNumber: string;
  seriesId: string;
  reservationId: string;
  status: string;
  issuedAt: Date;
  issuedById: string | null;
  issuedByName: string | null;
  origin: string;
  destination: string;
  serviceDate: Date;
  departureAt: Date | null;
  fareCents: number;
  currency: string;
  paymentMethod: string | null;
  annulledAt: Date | null;
  annulledById: string | null;
  annulledByName: string | null;
  annulReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Lo mínimo que este módulo necesita del cliente de Prisma. Se declara angosto a propósito:
 * los tests lo implementan con un fake y el código real recibe `PrismaClient` o el `tx` de una
 * transacción sin acoplarse a los tipos generados.
 */
export type TicketTransactionClient = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  serviceTicket: {
    findUnique(args: {
      where: { reservationId?: string; series_number?: { series: string; number: number }; id?: string };
    }): Promise<ServiceTicketRecord | null>;
    create(args: { data: Record<string, unknown> }): Promise<ServiceTicketRecord>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ServiceTicketRecord>;
  };
};

type ContadorRow = { id: string; series: string; number: number };

/**
 * Consume el próximo número de la serie. `UPDATE … RETURNING` toma el lock de la fila del
 * contador, así que dos emisiones simultáneas reciben números distintos aunque compartan
 * transacción, proceso o instancia. Si la serie no existe, es un error de configuración y no
 * se inventa una: emitir sin contador es emitir sin traza.
 */
async function consumirNumero(tx: TicketTransactionClient, series: string): Promise<{ seriesId: string; number: number }> {
  const filas = await tx.$queryRaw<ContadorRow[]>`
    UPDATE "TicketSeries"
       SET "nextNumber" = "nextNumber" + 1,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "series" = ${series}
    RETURNING "id", "series", ("nextNumber" - 1) AS "number"
  `;

  const fila = filas[0];
  if (!fila) {
    throw new Error(`No existe la serie de boletos "${series}".`);
  }

  return { seriesId: fila.id, number: Number(fila.number) };
}

export type EmitServiceTicketInput = {
  reservationId: string;
  /** `SEATED` es servicio público; aeropuerto, Chapelco y charter no llevan boleto numerado. */
  bookingMode: string | null | undefined;
  origin: string;
  destination: string;
  serviceDate: Date;
  departureAt?: Date | null;
  fareCents: number;
  currency?: string;
  paymentMethod?: string | null;
  issuedById?: string | null;
  issuedByName?: string | null;
  series?: string;
  now?: Date;
};

/**
 * Emite el boleto numerado de una reserva del servicio público.
 *
 * Es idempotente por reserva: si el boleto ya existe lo devuelve sin consumir otro número
 * (los reintentos del checkout y la pasada de reparación no pueden saltar correlativos).
 * Devuelve `null` cuando la reserva no corresponde al servicio público.
 */
export async function emitServiceTicket(
  tx: TicketTransactionClient,
  input: EmitServiceTicketInput
): Promise<ServiceTicketRecord | null> {
  if (!requiereBoletoNumerado(input.bookingMode)) return null;

  const origin = input.origin.trim();
  const destination = input.destination.trim();
  if (!origin || !destination) {
    throw new Error("El boleto necesita origen y destino.");
  }
  if (!Number.isInteger(input.fareCents) || input.fareCents < 0) {
    throw new Error(`Tarifa inválida para el boleto: ${input.fareCents}`);
  }

  const existente = await tx.serviceTicket.findUnique({ where: { reservationId: input.reservationId } });
  if (existente) return existente;

  const series = input.series ?? SERIE_WEB;
  const { seriesId, number } = await consumirNumero(tx, series);
  const ahora = input.now ?? new Date();

  return tx.serviceTicket.create({
    data: {
      series,
      number,
      displayNumber: formatTicketNumber(series, number),
      seriesId,
      reservationId: input.reservationId,
      status: ESTADO_EMITIDO,
      issuedAt: ahora,
      issuedById: input.issuedById ?? null,
      issuedByName: input.issuedByName ?? null,
      origin,
      destination,
      serviceDate: input.serviceDate,
      departureAt: input.departureAt ?? null,
      fareCents: input.fareCents,
      currency: input.currency ?? "ARS",
      paymentMethod: input.paymentMethod ?? null
    }
  });
}

export type AnnulServiceTicketInput = {
  reservationId: string;
  reason: string;
  annulledById?: string | null;
  annulledByName?: string | null;
  now?: Date;
};

/**
 * Anula un boleto: conserva su número y deja registrado motivo, fecha y usuario.
 * No se reutiliza ni se saltea el número — el hueco silencioso es lo que observa una auditoría.
 */
export async function annulServiceTicket(
  tx: TicketTransactionClient,
  input: AnnulServiceTicketInput
): Promise<ServiceTicketRecord> {
  const boleto = await tx.serviceTicket.findUnique({ where: { reservationId: input.reservationId } });
  if (!boleto) {
    throw new Error(`La reserva ${input.reservationId} no tiene boleto emitido.`);
  }
  if (boleto.status === ESTADO_ANULADO) return boleto;

  const motivo = input.reason.trim();
  if (!motivo) {
    throw new Error("La anulación necesita un motivo.");
  }

  return tx.serviceTicket.update({
    where: { id: boleto.id },
    data: {
      status: ESTADO_ANULADO,
      annulledAt: input.now ?? new Date(),
      annulledById: input.annulledById ?? null,
      annulledByName: input.annulledByName ?? null,
      annulReason: motivo
    }
  });
}

/** Busca un boleto por el número que muestra el pasajero (`W001`). */
export async function findServiceTicketByDisplayNumber(
  tx: TicketTransactionClient,
  texto: string
): Promise<ServiceTicketRecord | null> {
  const parsed = parseTicketNumber(texto);
  if (!parsed) return null;

  // Se busca por la clave única real (`series` + `number`): `displayNumber` es derivado y en el
  // esquema es sólo un índice, así que un `findUnique` por esa columna falla en Prisma.
  return tx.serviceTicket.findUnique({
    where: { series_number: { series: parsed.series, number: parsed.numero } }
  });
}
