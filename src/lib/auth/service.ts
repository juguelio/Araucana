import { createClient, type User as SupabaseUser } from "@supabase/supabase-js";
import { prisma } from "@/lib/db/prisma";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractBearerToken, toPublicUser } from "./session";

export type AuthenticatedUser = ReturnType<typeof toPublicUser>;
export type AppUser = AuthenticatedUser & { isActive: boolean };

export class AuthenticationError extends Error {
  constructor(message = "Sesion invalida") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "No autorizado") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class ApprovalRequiredError extends AuthorizationError {
  constructor() {
    super("La cuenta esta pendiente de aprobacion.");
    this.name = "ApprovalRequiredError";
  }
}

async function getSupabaseUser(token?: string | null): Promise<SupabaseUser | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return null;
  const client = token
    ? createClient(getSupabasePublicConfig().url, getSupabasePublicConfig().key, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
      })
    : await createSupabaseServerClient();
  const { data, error } = token
    ? await client.auth.getUser(token)
    : await client.auth.getUser();

  return error ? null : data.user;
}

export async function syncSignedInSupabaseUser(authUser: SupabaseUser): Promise<AppUser> {
  if (authUser.app_metadata?.provider !== "google") {
    throw new AuthenticationError("Inicia sesion usando Google.");
  }
  const email = authUser.email?.trim().toLowerCase();
  if (!email || !authUser.email_confirmed_at) {
    throw new AuthenticationError("Se requiere una cuenta Google con email verificado.");
  }

  const linked = await prisma.user.findUnique({ where: { supabaseUserId: authUser.id } });
  const existing = linked ?? await prisma.user.findUnique({ where: { email } });
  const displayName = typeof authUser.user_metadata?.full_name === "string"
    ? authUser.user_metadata.full_name
    : typeof authUser.user_metadata?.name === "string"
      ? authUser.user_metadata.name
      : null;

  if (existing?.supabaseUserId && existing.supabaseUserId !== authUser.id) {
    throw new AuthenticationError("Esta cuenta ya esta vinculada a otra identidad.");
  }

  let account;
  if (existing) {
    account = await prisma.user.update({
      where: { id: existing.id },
      data: {
        supabaseUserId: authUser.id,
        email,
        ...(existing.name ? {} : { name: displayName })
      }
    });
  } else {
    try {
      account = await prisma.user.create({
        data: {
          email,
          name: displayName,
          supabaseUserId: authUser.id,
          role: "USER",
          isActive: false
        }
      });
    } catch (error) {
      // A parallel first sign-in may have created this Google profile already.
      const concurrent = await prisma.user.findUnique({ where: { email } });
      if (!concurrent || concurrent.supabaseUserId !== authUser.id) throw error;
      account = concurrent;
    }
  }

  return { ...toPublicUser(account), isActive: account.isActive };
}

export async function getAppUserFromToken(token?: string | null): Promise<AppUser | null> {
  const authUser = await getSupabaseUser(token);
  return authUser ? syncSignedInSupabaseUser(authUser) : null;
}

export function getTokenFromRequest(request: Request) {
  return extractBearerToken(request.headers.get("authorization"));
}

export async function requireAuthenticatedUser(request: Request) {
  const user = await getAppUserFromToken(getTokenFromRequest(request));
  if (!user) throw new AuthorizationError();
  if (!user.isActive) throw new ApprovalRequiredError();
  return toPublicUser(user);
}

export async function requireAdminUser(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (user.role !== "ADMIN") {
    throw new AuthorizationError("Se requiere un usuario administrador");
  }
  return user;
}

export async function requireReservationsUser(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (user.role !== "ADMIN" && user.role !== "SECRETARY") {
    throw new AuthorizationError("Se requiere acceso a reservas");
  }
  return user;
}

export async function requireDriverUser(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (user.role !== "DRIVER") {
    throw new AuthorizationError("Se requiere un usuario chofer");
  }
  return user;
}
