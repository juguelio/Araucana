import { getAirportOfficePickup } from "./office-pickup";
import { buildServiceOrderBlocks } from "./service-order";
import { getAirportServiceOrderReservations } from "./service-order-repository";

/** Una sola configuración de origen para panel, Excel, enlace del chofer y acciones de edición. */
export async function getAirportServiceOrder(date: string, flightId?: string | null, { incluirVacias = false, soloVuelosOperativos = false, vuelos, soloRecorrido = false }: { incluirVacias?: boolean; soloVuelosOperativos?: boolean; vuelos?: string[]; soloRecorrido?: boolean } = {}) {
  const [reservas, oficina] = await Promise.all([
    getAirportServiceOrderReservations(date, flightId, { soloVuelosOperativos, vuelos, soloRecorrido }),
    getAirportOfficePickup()
  ]);
  const punto = oficina.point ? { latitude: oficina.point[0], longitude: oficina.point[1] } : null;
  return { oficina, blocks: buildServiceOrderBlocks(reservas, { incluirVacias, oficina: punto }) };
}
