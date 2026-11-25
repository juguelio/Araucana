/** Los estados históricos pertenecen a la parada. No guardaban una instantánea de la nave ni del chofer. */
export function registroAnteriorChapelco(estado: string, cantidad: number): string | undefined {
  if (estado === "NO_SHOW") return "Ausente · Registro anterior de la vuelta";
  if (estado === "BOARDED") return (cantidad === 1 ? "Subió 1 pasajero" : "Subieron " + cantidad + " pasajeros") + " · Registro anterior de la vuelta";
  if (estado === "TRANSPORTED") return (cantidad === 1 ? "1 pasajero trasladado" : cantidad + " pasajeros trasladados") + " · Registro anterior de la vuelta";
  return undefined;
}
