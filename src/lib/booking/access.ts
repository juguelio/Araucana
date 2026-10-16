import { isPrivateReservationCode } from "./codes";
import { AuthorizationError, getAppUserFromToken, getTokenFromRequest } from "@/lib/auth/service";

export async function requireReservationAccess(code: string, request?: Request) {
  // New links contain an unguessable capability. Legacy short codes require staff access.
  if (isPrivateReservationCode(code)) return;
  const user = await getAppUserFromToken(request ? getTokenFromRequest(request) : undefined);
  if (!user?.isActive || (user.role !== "ADMIN" && user.role !== "SECRETARY")) {
    throw new AuthorizationError("Para consultar una reserva anterior, contactá al equipo de Araucana.");
  }
}
