import { z } from "zod";
import { airportSearchBounds } from "@/lib/airport/place-search-area";
import { reverseAirportAddress } from "@/lib/airport/reverse-address";

const { north, south, west, east } = airportSearchBounds;
const coordinates = z.tuple([z.number().min(south).max(north), z.number().min(west).max(east)]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const point = coordinates.safeParse(body?.point);
  if (!point.success) return Response.json({ address: null }, { status: 400 });
  return Response.json({ address: await reverseAirportAddress(point.data, request.signal) }, {
    headers: { "Cache-Control": "no-store" }
  });
}
