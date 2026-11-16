import { NextResponse } from "next/server";
import { createAdminApiVehicle, listAdminApiVehicles } from "@/lib/admin/api";
import { handleApiError } from "@/lib/api/responses";
import { readJsonBody, requireAdminApi } from "../_utils";

export async function GET(request: Request) {
  try {
    await requireAdminApi(request);
    return NextResponse.json({ vehicles: await listAdminApiVehicles() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdminApi(request);
    const vehicle = await createAdminApiVehicle(await readJsonBody(request), actor);
    return NextResponse.json({ vehicle }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
