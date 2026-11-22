import type { AirportOfficePickup } from "@/lib/airport/office-pickup";
import { PAIHUEN_POINT } from "@/lib/airport/paihuen";
import { retiroPaihuen, type ServiceOrderBlock } from "@/lib/airport/service-order";
import { VerRecorrido } from "./recorrido-mapa";

/** El panel y el enlace del chofer muestran el mismo recorrido y la misma numeración. */
export function ServiceOrderMap({ block, oficina }: {
  block: ServiceOrderBlock;
  oficina: Pick<AirportOfficePickup, "address" | "point">;
}) {
  if (!block.passengers.length) return null;
  const primero = block.passengers[0];
  const paihuen = block.direction === "DEPARTURE" && retiroPaihuen(primero);
  return (
    <VerRecorrido
      sentido={block.direction}
      titulo={[block.flightNumber, block.vehicle?.name].filter(Boolean).join(" · ")}
      oficina={paihuen ? { address: "Paihuén", point: primero.pickup ? [primero.pickup.latitude, primero.pickup.longitude] : PAIHUEN_POINT } : oficina}
      origenPaihuen={paihuen}
      paradas={block.passengers.map((pasajero, indice) => ({
        code: pasajero.code,
        numero: indice + 1,
        nombre: pasajero.name,
        lugar: pasajero.lodging,
        pasajeros: pasajero.seats,
        punto: pasajero.pickup
      }))}
    />
  );
}
