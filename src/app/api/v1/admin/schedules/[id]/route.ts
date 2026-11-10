import { NextResponse } from "next/server";
import { deleteAdminApiSchedule, getAdminApiSchedule, patchAdminApiSchedule } from "@/lib/admin/api";
import { handleApiError } from "@/lib/api/responses";
import { readJsonBody, requireAdminApi } from "../../_utils";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireAdminApi(request);
    const { id } = await context.params;
    return NextResponse.json({ schedule: await getAdminApiSchedule(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAdminApi(request);
    const { id } = await context.params;
    return NextResponse.json({ schedule: await patchAdminApiSchedule(id, await readJsonBody(request), user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await requireAdminApi(request);
    const { id } = await context.params;
    return NextResponse.json(await deleteAdminApiSchedule(id));
  } catch (error) {
    return handleApiError(error);
  }
}
