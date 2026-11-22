"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { PickupPoint } from "@/lib/airport/pickup-zone";

/** Se monta sólo tras elegir un punto a mano. Una edición manual o una selección nueva cancela la anterior. */
export function MapPointAddress({ point, onResult }: {
  point: PickupPoint;
  onResult: (address: string) => void;
}) {
  const [result, setResult] = useState<{ point: PickupPoint; found: boolean } | null>(null);
  const finish = useEffectEvent((requested: PickupPoint, address: string) => {
    if (point !== requested) return;
    setResult({ point, found: Boolean(address) });
    onResult(address);
  });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      let address = "";
      try {
        const response = await fetch("/api/v1/airport/address/reverse", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ point }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6500)])
        });
        if (response.ok) address = (await response.json()).address || "";
      } catch { /* El punto se puede usar aunque el servicio no responda. */ }
      if (!controller.signal.aborted) finish(point, address);
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [point]);
  return <p className="muted" role="status">{result?.point !== point ? "Buscando la dirección del punto…"
    : result.found ? "Dirección cercana al punto marcado. Verificá que corresponda a la entrada."
    : "No encontramos una dirección cercana. Se conserva el punto marcado."}</p>;
}
