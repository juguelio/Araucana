import { NextResponse } from "next/server";
import { createAdminApiSchedule, listAdminApiSchedules } from "@/lib/admin/api";
import { handleApiError } from "@/lib/api/responses";
import { readJsonBody, requireAdminApi } from "../_utils";

export async function GET(request: Request) {
  try {
    await requireAdminApi(request);
    return NextResponse.json({ schedules: await listAdminApiSchedules() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdminApi(request);
    const schedule = await createAdminApiSchedule(await readJsonBody(request), user.id);
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
