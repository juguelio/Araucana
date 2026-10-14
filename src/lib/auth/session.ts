import { toPublicRole } from "./roles";

export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  role: ReturnType<typeof toPublicRole>;
};

export const SESSION_COOKIE_NAME = "araucana_session";

type UserLike = Omit<PublicUser, "role"> & { role: string };

export function extractBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.trim().split(/\s+/);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export function toPublicUser(user: UserLike): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: toPublicRole(user.role)
  };
}
