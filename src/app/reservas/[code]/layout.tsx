import type { ReactNode } from "react";
import "./boleto.css";

/**
 * Estilos del boleto (#370). Van en el layout porque Next no permite importar CSS global desde una
 * page: así los usa tanto la página de la reserva como la copia imprimible.
 */
export default function BoletoLayout({ children }: { children: ReactNode }) {
  return children;
}
