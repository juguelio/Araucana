import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/responses";
import { createAdminApiRoute, listAdminApiRoutes } from "@/lib/admin/api";
import { readJsonBody, requireAdminApi } from "../_utils";

export async function GET(request: Request) {
  try {
    await requireAdminApi(request);
    return NextResponse.json({ routes: await listAdminApiRoutes() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdminApi(request);
    const route = await createAdminApiRoute(await readJsonBody(request), actor);
    return NextResponse.json({ route }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
