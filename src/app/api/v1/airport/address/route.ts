import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { airportAddressSchema, lookupAirportAddress } from "@/lib/airport/address-lookup";
import { suggestAirportPlaces } from "@/lib/airport/place-suggestions";
import { lookupStreetOptions, resolveStreetAddress } from "@/lib/airport/street-address";
import { resolveMunicipalLodging } from "@/lib/airport/lodging-address";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body?.kind === "lodging") {
    // Fichas del padrón municipal («183») y del catálogo complementario («sma-125», «nqn-terra-alta»).
    if (typeof body.id !== "string" || !/^(?:\d{1,8}|sma-\d{1,8}|nqn-[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(body.id) || body.id.length > 80) {
      return jsonError("INVALID_LODGING", "Elegí un alojamiento de la lista.", 400);
    }
    const match = await resolveMunicipalLodging(body.id, request.signal);
    return match ? NextResponse.json({ match }, { headers: noStore })
      : jsonError("LODGING_NOT_FOUND", "Ese alojamiento no figura en el catálogo.", 404);
  }
  const parsed = airportAddressSchema.safeParse(body?.address);
  if (!parsed.success) return jsonError("INVALID_ADDRESS", "Ingresá una dirección válida.", 400);

  try {
    if (body?.kind === "streets") {
      return NextResponse.json({ streets: await lookupStreetOptions(parsed.data, request.signal) }, { headers: noStore });
    }
    if (body?.kind === "street-address") {
      const number = typeof body?.number === "string" ? body.number : "";
      return NextResponse.json({ match: await resolveStreetAddress(parsed.data, number, request.signal) }, { headers: noStore });
    }
    const result = body?.kind === "suggestions"
      ? { matches: await suggestAirportPlaces(parsed.data, request.signal) }
      : await lookupAirportAddress(parsed.data);
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    return handleApiError(error);
  }
}
