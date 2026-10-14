import { cookies } from "next/headers";
import { Strategy as LocalStrategy } from "passport-local";
import passport from "passport";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "./password";
import { extractBearerToken, SESSION_COOKIE_NAME, toPublicUser } from "./session";

const JWT_ISSUER = "araucana";
const JWT_AUDIENCE = "araucana-api";
const DEFAULT_SESSION_DAYS = 30;

export type AuthenticatedUser = ReturnType<typeof toPublicUser>;
export type AppUser = AuthenticatedUser & { isActive: boolean };

type AuthUserRecord = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  passwordHash?: string | null;
};

export class AuthenticationError extends Error {
  constructor(message = "Credenciales invalidas") {
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

function getJwtSecret() {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("AUTH_JWT_SECRET debe tener al menos 32 bytes.");
  }
  return secret;
}

export function getConfiguredSessionDays() {
  const configuredDays = Number(process.env.SESSION_DAYS ?? DEFAULT_SESSION_DAYS);
  return Number.isFinite(configuredDays) && configuredDays > 0
    ? Math.min(Math.floor(configuredDays), 90)
    : DEFAULT_SESSION_DAYS;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

passport.use("local", new LocalStrategy(
  { usernameField: "email", passwordField: "password", session: false },
  (username, submittedPassword, done) => {
    void (async () => {
      const user = await prisma.user.findUnique({ where: { email: username.trim().toLowerCase() } });
      if (!user?.passwordHash || !(await verifyPassword(submittedPassword, user.passwordHash))) {
        done(null, false, { message: "Credenciales invalidas" });
        return;
      }
      done(null, user as AuthUserRecord);
    })().catch(done);
  }
));

async function authenticateWithPassport(email: string, password: string) {
  return new Promise<AuthUserRecord | null>((resolve, reject) => {
    const request = { body: { email, password }, headers: {} };
    const authenticate = passport.authenticate("local", { session: false }, (error: Error | null, user: unknown) => {
      if (error) reject(error);
      else resolve(user ? user as AuthUserRecord : null);
    });
    authenticate(request as never, {} as never, (error?: Error) => error ? reject(error) : resolve(null));
  });
}

function signAccessToken(userId: string, expiresAt: Date) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresInSeconds = Math.max(1, Math.floor(expiresAt.getTime() / 1000) - nowSeconds);
  return jwt.sign({}, getJwtSecret(), {
    algorithm: "HS256",
    subject: userId,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    jwtid: randomBytes(16).toString("hex"),
    expiresIn: expiresInSeconds
  });
}

export async function createSessionForUser(user: AuthUserRecord, now = new Date()) {
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + getConfiguredSessionDays());
  const token = signAccessToken(user.id, expiresAt);
  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId: user.id, expiresAt }
  });
  return { token, expiresAt, user: toPublicUser(user), isActive: user.isActive };
}

export async function createSessionForCredentials(input: { email: string; password: string }) {
  const user = await authenticateWithPassport(input.email, input.password);
  if (!user) throw new AuthenticationError();
  return createSessionForUser(user);
}

export async function registerWithCredentials(input: { email: string; password: string; name?: string }) {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email,
      name: input.name?.trim() || null,
      passwordHash,
      role: "USER",
      isActive: false
    }
  });
  return toPublicUser(user);
}

function verifyAccessToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ["HS256"], issuer: JWT_ISSUER, audience: JWT_AUDIENCE
    });
    return typeof payload === "string" ? null : payload;
  } catch {
    return null;
  }
}

export async function getAppUserFromToken(token?: string | null): Promise<AppUser | null> {
  let resolvedToken = token;
  if (resolvedToken === undefined) {
    resolvedToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
  }
  if (!resolvedToken) return null;

  const payload = verifyAccessToken(resolvedToken);
  if (!payload?.sub) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(resolvedToken) },
    include: { user: true }
  });
  if (!session || session.userId !== payload.sub || session.expiresAt.getTime() <= Date.now()) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => null);
    return null;
  }
  return { ...toPublicUser(session.user), isActive: session.user.isActive };
}

export async function deleteSessionByToken(token: string | null) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function refreshSessionByToken(token: string | null) {
  if (!token) throw new AuthenticationError("Sesion invalida");
  const user = await getAppUserFromToken(token);
  if (!user) throw new AuthenticationError("Sesion invalida");
  const record = await prisma.user.findUnique({ where: { id: user.id } });
  if (!record) throw new AuthenticationError("Sesion invalida");
  await deleteSessionByToken(token);
  return createSessionForUser(record);
}

export function getTokenFromRequest(request: Request) {
  const bearerToken = extractBearerToken(request.headers.get("authorization"));
  if (bearerToken) return bearerToken;
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const sessionCookie = cookieHeader.split(";").map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!sessionCookie) return null;
  try { return decodeURIComponent(sessionCookie.slice(SESSION_COOKIE_NAME.length + 1)); } catch { return null; }
}

export async function requireAuthenticatedUser(request: Request) {
  const user = await getAppUserFromToken(getTokenFromRequest(request));
  if (!user) throw new AuthorizationError();
  if (!user.isActive) throw new ApprovalRequiredError();
  return toPublicUser(user);
}

export async function requireAdminUser(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (user.role !== "ADMIN") throw new AuthorizationError("Se requiere un usuario administrador");
  return user;
}

export async function requireReservationsUser(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (user.role !== "ADMIN" && user.role !== "SECRETARY") throw new AuthorizationError("Se requiere acceso a reservas");
  return user;
}

export async function requireDriverUser(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (user.role !== "DRIVER") throw new AuthorizationError("Se requiere un usuario chofer");
  return user;
}

export async function bootstrapAdminPassword(input: { email: string; password: string; token: string }) {
  const expected = process.env.AUTH_BOOTSTRAP_TOKEN;
  if (!expected || Buffer.byteLength(expected) < 32) throw new AuthorizationError("La inicializacion no esta habilitada.");
  const suppliedBytes = Buffer.from(input.token);
  const expectedBytes = Buffer.from(expected);
  const { timingSafeEqual } = await import("node:crypto");
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    throw new AuthorizationError("Token de inicializacion invalido.");
  }

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    const initialized = await tx.user.count({ where: { role: "ADMIN", passwordHash: { not: null } } });
    if (initialized > 0) throw new AuthorizationError("El administrador inicial ya fue configurado.");
    const account = await tx.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    if (!account || account.role !== "ADMIN" || account.passwordHash) {
      throw new AuthorizationError("No hay una cuenta administradora pendiente de inicializacion para ese email.");
    }
    const updated = await tx.user.updateMany({
      where: { id: account.id, role: "ADMIN", passwordHash: null },
      data: { passwordHash, isActive: true }
    });
    if (updated.count !== 1) throw new AuthorizationError("El administrador inicial ya fue configurado.");
  }, { isolationLevel: "Serializable" });
}
