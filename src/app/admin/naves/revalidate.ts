import { revalidatePath } from "next/cache";

/** El listado de naves, la ficha de cada una y sus secciones (/admin/naves/[id]/…). */
export function revalidarNaves() {
  revalidatePath("/admin");
  revalidatePath("/admin/naves");
  for (const seccion of ["", "/recorridos", "/vencimientos", "/danios", "/reparaciones", "/editar"]) {
    revalidatePath(`/admin/naves/[id]${seccion}`, "page");
  }
}
