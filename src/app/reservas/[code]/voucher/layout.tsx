import type { ReactNode } from "react";
import "./voucher.css";

/**
 * Next no permite importar CSS global desde una `page.tsx` (se evalúa como Server Component); el
 * layout sí. El estilo vive acá y no en `globals.css` porque sólo aplica al voucher: márgenes de
 * impresión A4 y el reset de lo que no debe salir en papel.
 */
export default function VoucherLayout({ children }: { children: ReactNode }) {
  return children;
}
