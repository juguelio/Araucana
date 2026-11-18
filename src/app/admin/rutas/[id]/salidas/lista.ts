/**
 * Lista de salidas de una ruta (issue #192): el calendario del mes sirve para programar, pero para
 * «encontrar» una salida entre 364 el operador necesita una lista con paginación y orden por columna,
 * como en la planilla con la que trabaja hoy.
 *
 * La lista se arma en memoria porque la página ya trae todas las salidas de la ruta enteras (para el
 * calendario y los números del resumen): ordenar y paginar acá no cuesta una consulta más.
 */
import { ordenarEnMemoria, type OrdenDeListado } from "@/lib/admin/list-order";

export const vistasDeSalidas = {
  calendario: "Calendario",
  lista: "Lista"
} as const;
export type VistaSalidas = keyof typeof vistasDeSalidas;

/** Vista pedida en la URL; cualquier cosa rara cae al calendario, que es como abre la pantalla. */
export function vistaDeSalidas(raw: string | undefined): VistaSalidas {
  return raw && Object.hasOwn(vistasDeSalidas, raw) ? (raw as VistaSalidas) : "calendario";
}

/**
 * Columnas ordenables. `fecha` es la salida; `nave` el nombre de la unidad asignada; `cupo` los lugares
 * libres. La hora no es columna propia: va con la fecha, y ordenar por fecha ya la deja en orden.
 */
export const COLUMNAS_SALIDAS = ["fecha", "nave", "estado", "cupo"] as const;
export type ColumnaSalida = (typeof COLUMNAS_SALIDAS)[number];
export const ORDEN_INICIAL_SALIDAS: OrdenDeListado<ColumnaSalida> = { columna: "fecha", direccion: "asc" };

export type SalidaOrdenable = {
  departureAt: Date;
  vehicleName: string;
  status: string;
  availableSeats: number;
};

/** Las salidas de la ruta en el orden pedido; a igual valor quedan como venían (fecha ascendente). */
export function ordenarSalidas<T extends SalidaOrdenable>(
  salidas: readonly T[],
  orden: OrdenDeListado<ColumnaSalida>
): T[] {
  return ordenarEnMemoria(salidas, orden, {
    fecha: (salida) => salida.departureAt,
    nave: (salida) => salida.vehicleName,
    estado: (salida) => salida.status,
    cupo: (salida) => salida.availableSeats
  });
}
