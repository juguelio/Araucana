import { fechaInicialDeAlta } from "@/lib/special-trips/dia";
import { TripEditPage } from "../trip-edit-page";

/**
 * Alta de un viaje especial. Desde la vista «Día» se llega con `?fecha=YYYY-MM-DD` y el formulario abre en
 * ese día: antes abría siempre en hoy y el viaje se guardaba en la fecha equivocada (issue #443).
 */
export default async function NewTripPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <TripEditPage initialDate={fechaInicialDeAlta(params.fecha, new Date())} />;
}
