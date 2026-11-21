"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresca una pantalla que se renderiza en el servidor sin recargar el navegador.
 *
 * «Servicios de hoy» muestra cuentas regresivas («en 22 min») y estados de unidades que cambian: sin
 * esto la pantalla queda congelada en la hora en que se abrió y el operador decide sobre datos viejos.
 * El mapa en vivo ya tiene su propio polling; esto es para las vistas que no lo tienen.
 */
export function AutoRefresco({ cadaMs = 60_000 }: { cadaMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), cadaMs);
    return () => clearInterval(id);
  }, [router, cadaMs]);

  return null;
}
