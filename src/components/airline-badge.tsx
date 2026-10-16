"use client";

import { useState } from "react";
import { airlineCode, airlineLogo } from "@/lib/airport/airlines";

/**
 * Logo de la aerolínea del vuelo. Si no tenemos la imagen (o falla la carga), cae al código
 * en un badge: preferimos un cuadrado con "AR" antes que un ícono roto.
 */
export function AirlineBadge({ code, size = 34 }: { code: string | null | undefined; size?: number }) {
  const logo = airlineLogo(code);
  const [fallo, setFallo] = useState(false);
  const etiqueta = airlineCode(code) ?? "—";

  return (
    <span className="airline-badge" style={{ width: size, height: size }} title={etiqueta}>
      {logo && !fallo ? (
        <img src={logo} alt={etiqueta} width={size} height={size} onError={() => setFallo(true)} loading="lazy" />
      ) : (
        etiqueta
      )}
    </span>
  );
}
