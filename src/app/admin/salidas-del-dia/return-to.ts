import { redirect } from "next/navigation";

/**
 * Las acciones de aeropuerto y Chapelco vuelven a su propia pantalla. Cuando se usan desde
 * «Salidas del día» (issue #174) mandan `volver=tablero` y vuelven al tablero del mismo día.
 * Sólo se acepta ese valor fijo: nunca una URL que venga del formulario.
 */
export const BOARD_RETURN_FIELD = "volver";
export const BOARD_RETURN_VALUE = "tablero";

export function returnsToBoard(formData: FormData) {
  return formData.get(BOARD_RETURN_FIELD) === BOARD_RETURN_VALUE;
}

export function boardHref(dateKey: string, notice?: string) {
  const query = new URLSearchParams({ date: dateKey });
  if (notice) query.set("notice", notice);
  return `/admin/salidas-del-dia?${query.toString()}`;
}

export function redirectToBoard(dateKey: string, notice: string): never {
  redirect(boardHref(dateKey, notice));
}
