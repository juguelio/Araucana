import { redirect } from "next/navigation";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { ALTA_AEROPUERTO } from "./aeropuerto-alta";

/**
 * El alta de aeropuerto ahora vive en la pantalla única de «Reservar» (pedido de Jugue, 19-nov). Los
 * links viejos (favoritos, el panel, la hoja del día) siguen andando: redirigen con lo que traían.
 */
export default async function NewAirportReservationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const extra = new URLSearchParams();
  for (const clave of ["date", "tramos", "sentido", "vuelo"]) {
    const valor = params[clave];
    if (typeof valor === "string" && valor) extra.set(clave, valor);
  }
  const resto = extra.toString();
  redirect(resto ? `${ALTA_AEROPUERTO}&${resto}` : ALTA_AEROPUERTO);
}
