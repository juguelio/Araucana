"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { posicionDeAhora } from "@/lib/driver/tablero-choferes";

/**
 * La noción de «ahora» en el tablero de choferes (28-nov). Reemplaza la línea roja que cruzaba cada
 * fila (era ruido: pedido de Jugue el 27-nov) por tres señales más calmas, todas desde una sola variable
 * CSS `--ahora` (0–100) en el contenedor:
 *
 * - una pastilla «12:29» en la regla de horas (que queda fija arriba al bajar);
 * - en cada línea, lo que ya pasó del día apenas sombreado (el borde de la sombra es el ahora);
 * - en cada servicio, una barrita de avance abajo; los que terminaron, más claros.
 *
 * El reloj corre en el navegador (cada 30 s) y la página se refresca sola cada 5 minutos para que
 * «Manejando» y «Próximo» no queden viejos. Sólo el día de hoy: otro día no tiene ahora.
 */

const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
const RELOJ_MS = 30_000;
const REFRESCO_MS = 5 * 60_000;

type Ahora = { posicion: number | null; hora: string };
const ContextoAhora = createContext<Ahora | null>(null);

export function TableroConReloj({ activo, inicio, fin, ahoraInicial, children }: {
  activo: boolean;
  /** Los límites de la línea del día, en ms (`limitesDeLinea`). */
  inicio: number;
  fin: number;
  /** El ahora del servidor: el primer render coincide con el HTML y después corre el reloj. */
  ahoraInicial: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const [ahora, setAhora] = useState(ahoraInicial);

  useEffect(() => {
    if (!activo) return;
    const tic = () => setAhora(Date.now());
    tic();
    const reloj = window.setInterval(tic, RELOJ_MS);
    const refresco = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESCO_MS);
    return () => {
      window.clearInterval(reloj);
      window.clearInterval(refresco);
    };
  }, [activo, router]);

  const valor: Ahora | null = activo ? { posicion: posicionDeAhora(ahora, { inicio, fin }), hora: HORA.format(ahora) } : null;
  const estilo = valor?.posicion != null ? ({ "--ahora": valor.posicion } as CSSProperties) : undefined;

  return (
    <ContextoAhora.Provider value={valor}>
      <div className="choferes-tiempo" data-hoy={valor?.posicion != null || undefined} style={estilo}>
        {children}
      </div>
    </ContextoAhora.Provider>
  );
}

/** La pastilla de la regla de horas. */
export function MarcaDeAhora() {
  const ahora = useContext(ContextoAhora);
  if (!ahora || ahora.posicion == null) return null;
  return <time className="choferes-regla-ahora" aria-label={`Ahora, ${ahora.hora}`}>{ahora.hora}</time>;
}

/** «Hoy · 12:29» en la cabecera del día (en el teléfono no hay regla). */
export function HoraDeAhora({ antes = "" }: { antes?: string }) {
  const ahora = useContext(ContextoAhora);
  if (!ahora) return null;
  return <>{antes}<time>{ahora.hora}</time></>;
}
