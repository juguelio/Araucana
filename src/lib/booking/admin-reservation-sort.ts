import type { Prisma } from "@prisma/client";
import { leerOrden, type OrdenDeListado } from "@/lib/admin/list-order";
import type { AdminReservationFilters } from "./admin-filters";

/**
 * Columnas por las que se puede ordenar el listado de reservas del panel (issue #192).
 *
 * La lista es la **única** puerta: lo que llega en `?orden=` se compara contra esto y, si no está, el
 * listado usa el orden de siempre (alta más reciente). Ninguna columna fuera de acá puede terminar en
 * un `orderBy` de Prisma.
 *
 * `Fecha del viaje` no está: no es una columna, es el día que sale de tres fuentes distintas (salida
 * programada, vuelo del aeropuerto o fecha de Chapelco) y Prisma no puede ordenar por esa expresión sin
 * un campo persistido. Queda para una etapa aparte, con el dato guardado en la reserva.
 */
export const ADMIN_RESERVATION_ORDER_COLUMNS = ["codigo", "pasajero", "creadaPor", "asiento", "estado", "pago", "alta"] as const;
export type AdminReservationOrderColumn = (typeof ADMIN_RESERVATION_ORDER_COLUMNS)[number];

/**
 * El orden de siempre del listado: la reserva dada de alta más recientemente arriba. `alta` no tiene
 * encabezado propio —es el criterio con el que la pantalla abre desde siempre—, pero viaja en la URL
 * igual que las demás para que un link pueda reproducir la vista.
 */
export const ADMIN_RESERVATION_DEFAULT_ORDER: OrdenDeListado<AdminReservationOrderColumn> = {
  columna: "alta",
  direccion: "desc"
};

/** Orden pedido en la URL, saneado contra la lista blanca. */
export function adminReservationOrder(input: AdminReservationFilters): OrdenDeListado<AdminReservationOrderColumn> {
  return leerOrden(ADMIN_RESERVATION_ORDER_COLUMNS, ADMIN_RESERVATION_DEFAULT_ORDER, {
    orden: input.orden,
    dir: input.dir
  });
}

/**
 * `orderBy` de Prisma para el listado. Siempre cierra con el código como desempate: sin él, dos
 * reservas con el mismo valor (mismo estado, misma fecha de alta) pueden cambiar de página entre
 * pedidos y una fila se ve dos veces o ninguna.
 */
export function adminReservationOrderBy(input: AdminReservationFilters): Prisma.ReservationOrderByWithRelationInput[] {
  const { columna, direccion } = adminReservationOrder(input);
  const desempate: Prisma.ReservationOrderByWithRelationInput = { code: "asc" };

  switch (columna) {
    case "alta":
      return [{ createdAt: direccion }, desempate];
    case "codigo":
      // El código es único: no necesita desempate.
      return [{ code: direccion }];
    case "pasajero":
      return [{ passenger: { firstName: direccion } }, { passenger: { lastName: direccion } }, desempate];
    case "creadaPor":
      return [{ createdByName: direccion }, desempate];
    case "asiento":
      return [{ seatNumber: direccion }, desempate];
    case "estado":
      return [{ status: direccion }, desempate];
    case "pago":
      return [{ payment: { status: direccion } }, desempate];
  }
}
