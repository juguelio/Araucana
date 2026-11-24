/**
 * Ocupación de naves y choferes para el modal de asignar (24-nov, pedido de Jugue: «más fácil ver y
 * asignar»). Antes el modal mostraba todas las naves y todos los choferes iguales, y el cruce recién
 * aparecía al guardar. Ahora cada opción dice si está libre a la hora del servicio, o en qué está.
 *
 * Son las mismas reglas que el chequeo al guardar (`fleetConflicts` / `driverConflicts` en
 * `special-trips/conflicts.ts`), pero calculadas una vez para todo el día: la página carga la
 * ocupación con una consulta por fuente y cada modal la cruza en memoria con su propio horario.
 * El chequeo al guardar sigue siendo el que manda.
 */

export type Ocupacion = {
  /** Qué servicio ocupa: `salida:<id>`, `vuelo:<id>`, `viaje:<id>`, `chapelco:<id>`. */
  clave: string;
  vehicleIds: string[];
  driverIds: string[];
  desde: Date;
  hasta: Date;
  /** «Servicio público 10:00 · San Martín → Villa Traful». */
  etiqueta: string;
  /** Chapelco (día entero) y aeropuerto (ventana estimada) se avisan como posible cruce. */
  posible: boolean;
};

export type EstadoDeOpcion = { estado: "ocupada" | "posible"; detalle: string };

/**
 * Para cada nave (o chofer) que no está libre en la ventana, en qué está. Se excluyen los servicios
 * de `excluir` (el propio servicio: una salida no choca consigo misma, ni un vuelo con su recorrida).
 * Lo que no aparece en el resultado está libre.
 */
export function ocupacionEnVentana(
  ocupaciones: readonly Ocupacion[],
  tipo: "nave" | "chofer",
  ventana: { desde: Date; hasta: Date },
  excluir: readonly string[] = []
): Record<string, EstadoDeOpcion> {
  const resultado: Record<string, EstadoDeOpcion> = {};
  const cruces = ocupaciones
    .filter((ocupacion) => !excluir.includes(ocupacion.clave))
    .filter((ocupacion) => ocupacion.desde < ventana.hasta && ocupacion.hasta > ventana.desde)
    .sort((a, b) => Number(a.posible) - Number(b.posible) || a.desde.getTime() - b.desde.getTime());
  for (const cruce of cruces) {
    for (const id of tipo === "nave" ? cruce.vehicleIds : cruce.driverIds) {
      const previo = resultado[id];
      // Un cruce seguro le gana a un posible; entre iguales, queda el primero y se cuentan los demás.
      if (!previo) resultado[id] = { estado: cruce.posible ? "posible" : "ocupada", detalle: cruce.etiqueta };
      else if (!previo.detalle.endsWith("más")) resultado[id] = { ...previo, detalle: `${previo.detalle} y más` };
    }
  }
  return resultado;
}

/** Orden de las opciones: la actual primero, después las libres, las de posible cruce y las ocupadas. */
export function ordenDeOpcion(id: string, actual: string, ocupacion: Record<string, EstadoDeOpcion>): number {
  if (id === actual) return 0;
  const estado = ocupacion[id]?.estado;
  return estado === "ocupada" ? 3 : estado === "posible" ? 2 : 1;
}
