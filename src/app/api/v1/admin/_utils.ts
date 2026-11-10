import { ApiError } from "@/lib/api/responses";
import { requireAdminUser } from "@/lib/auth/service";

export async function requireAdminApi(request: Request) {
  return requireAdminUser(request);
}

export async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError("INVALID_JSON", "El cuerpo de la solicitud debe ser JSON valido.", 400);
  }
}
