import { NextResponse } from "next/server";
import { getAdminApiReservation, patchAdminApiReservation } from "@/lib/admin/api";
import { handleApiError } from "@/lib/api/responses";
import { readJsonBody, requireAdminApi } from "../../_utils";

type RouteContext = {
  params: Promise<{ code: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireAdminApi(request);
    const { code } = await context.params;
    return NextResponse.json({ reservation: await getAdminApiReservation(code) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireAdminApi(request);
    const { code } = await context.params;
    return NextResponse.json({ reservation: await patchAdminApiReservation(code, await readJsonBody(request), actor) });
  } catch (error) {
    return handleApiError(error);
  }
}
