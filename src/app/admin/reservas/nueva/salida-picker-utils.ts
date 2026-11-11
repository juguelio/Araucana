/**
 * Lógica del selector de salida del alta manual (sin React, para poder testearla).
 *
 * Las funciones de agrupación por día viven en `@/lib/booking/schedule-days` porque las comparte
 * la página pública de reserva; acá sólo queda el tipo que arma el panel.
 */

import type { StopFare } from "@/lib/booking/stop-fares";

export {
  DIAS_EN_TIRA,
  diaEfectivo,
  diasConSalidas,
  tiraDeDias,
  type DiaConSalidas
} from "@/lib/booking/schedule-days";

export type SalidaOption = {
  id: string;
  from: string;
  to: string;
  dayKey: string;
  dayLabel: string;
  timeLabel: string;
  availableSeats: number;
  status: string;
  stopFares?: StopFare[];
  bookingMode?: string;
  priceCents?: number;
  currency?: string;
};
