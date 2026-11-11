import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { airportAddressSchema, lookupAirportAddress } from "@/lib/airport/address-lookup";
import { suggestAirportPlaces } from "@/lib/airport/place-suggestions";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = airportAddressSchema.safeParse(body?.address);
  if (!parsed.success) return jsonError("INVALID_ADDRESS", "Ingresá una dirección válida.", 400);

  try {
    const result = body?.kind === "suggestions"
      ? { matches: await suggestAirportPlaces(parsed.data, request.signal) }
      : await lookupAirportAddress(parsed.data);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
