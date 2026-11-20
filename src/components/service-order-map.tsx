import type { AirportOfficePickup } from "@/lib/airport/office-pickup";
import type { ServiceOrderBlock } from "@/lib/airport/service-order";
import { VerRecorrido } from "./recorrido-mapa";

/** El panel y el enlace del chofer muestran el mismo recorrido y la misma numeración. */
export function ServiceOrderMap({ block, oficina }: {
  block: ServiceOrderBlock;
  oficina: Pick<AirportOfficePickup, "address" | "point">;
}) {
  if (!block.passengers.length) return null;
  return (
    <VerRecorrido
      sentido={block.direction}
      titulo={[block.flightNumber, block.vehicle?.name].filter(Boolean).join(" · ")}
      oficina={oficina}
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
