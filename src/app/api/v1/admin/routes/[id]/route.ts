import { NextResponse } from "next/server";
import { deleteAdminApiRoute, getAdminApiRoute, patchAdminApiRoute } from "@/lib/admin/api";
import { handleApiError } from "@/lib/api/responses";
import { readJsonBody, requireAdminApi } from "../../_utils";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireAdminApi(request);
    const { id } = await context.params;
    return NextResponse.json({ route: await getAdminApiRoute(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireAdminApi(request);
    const { id } = await context.params;
    return NextResponse.json({ route: await patchAdminApiRoute(id, await readJsonBody(request), actor) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireAdminApi(request);
    const { id } = await context.params;
    return NextResponse.json(await deleteAdminApiRoute(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}
