import { randomBytes, timingSafeEqual } from "node:crypto";
import passport from "passport";
import GoogleStrategy from "passport-google-oidc";
import { prisma } from "@/lib/db/prisma";

const GOOGLE_STATE_COOKIE = "araucana_google_state";
const GOOGLE_ISSUER = "https://accounts.google.com";

type GoogleProfile = {
  id?: string;
  displayName?: string;
  emails?: Array<{ value: string }>;
  _json?: Record<string, unknown>;
};

type GoogleUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  passwordHash: string | null;
};

type PassportResult = {
  redirect?: string;
  user?: GoogleUser | false;
  error?: Error;
  info?: unknown;
  status?: number;
};

const ALLOWED_PRODUCTION_HOSTS = new Set([
  "araucana.vercel.app",
  "araucana.com.ar",
  "www.araucana.com.ar"
]);

function getAuthBaseUrl() {
  const configured = process.env.AUTH_BASE_URL;
  if (configured) return new URL(configured).origin;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://araucana.vercel.app";
}

function getRequestBaseUrl(request: Request) {
  const requestUrl = new URL(request.url);
  if (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(requestUrl.hostname)) {
    return requestUrl.origin;
  }
  if (ALLOWED_PRODUCTION_HOSTS.has(requestUrl.hostname)) return requestUrl.origin;
  return getAuthBaseUrl();
}

export function getGoogleCallbackUrl(request?: Request) {
  const baseUrl = request ? getRequestBaseUrl(request) : getAuthBaseUrl();
  return `${baseUrl}/api/v1/auth/google/callback`;
}

function createGoogleStrategy(callbackURL: string, stateStore = createGoogleStateStore()) {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientID || !clientSecret) throw new Error("El acceso con Google todavía no está configurado.");

  return new GoogleOidcStrategy({
    clientID,
    clientSecret,
    callbackURL,
    userInfoURL: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: ["email", "profile"],
    skipUserProfile: false,
    store: stateStore
  }, (issuer, profile, done) => {
    void findOrCreateGoogleUser(issuer, profile).then((user) => done(null, user)).catch((error: unknown) => {
      done(error instanceof Error ? error : new Error("No se pudo validar la cuenta de Google."));
    });
  });
}

function getCookieValue(cookieHeader: string | undefined, name: string) {
  const item = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : null;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function createGoogleStateStore() {
  return {
    store(_request: unknown, context: { nonce?: string }, appState: string | undefined, _meta: unknown, done: (error: Error | null, state?: string) => void) {
      if (!appState || !context.nonce) {
        done(new Error("Falta el estado de autenticación de Google."));
        return;
      }
      done(null, appState);
    },
    verify(request: { headers: Record<string, string | undefined> }, state: string, done: (error: Error | null, context?: { nonce?: string } | false, appState?: string) => void) {
      const storedState = getCookieValue(request.headers.cookie, GOOGLE_STATE_COOKIE);
      const [expectedState, expectedNonce] = storedState?.split(".") ?? [];
      if (!expectedState || !expectedNonce || !safeEqual(expectedState, state)) {
        done(null, false, "No se pudo verificar la solicitud de acceso.");
        return;
      }
      done(null, { nonce: expectedNonce }, undefined);
    }
  };
}

async function findOrCreateGoogleUser(issuer: string, profile: GoogleProfile): Promise<GoogleUser> {
  if (issuer !== GOOGLE_ISSUER || !profile.id) throw new Error("La identidad de Google no es válida.");

  const email = profile.emails?.[0]?.value?.trim().toLowerCase();
  const emailVerified = profile._json?.email_verified === true;
  if (!email || !emailVerified) throw new Error("Google no confirmó el email de esta cuenta.");

  const bySubject = await prisma.user.findUnique({ where: { googleSub: profile.id } });
  if (bySubject) return bySubject;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.googleSub && existing.googleSub !== profile.id) {
      throw new Error("Este email ya está vinculado a otra cuenta de Google.");
    }
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        googleSub: profile.id,
        name: existing.name ?? profile.displayName ?? null
      }
    });
  }

  return prisma.user.create({
    data: {
      email,
      googleSub: profile.id,
      name: profile.displayName ?? null,
      role: "USER",
      isActive: false
    }
  });
}

class GoogleOidcStrategy extends GoogleStrategy {
  authorizationParams(options: Record<string, unknown>): Record<string, string> {
    return typeof options.nonce === "string" ? { nonce: options.nonce } : {};
  }
}

let configuredClient = "";

function ensureGoogleStrategy(request: Request) {
  const callbackURL = getGoogleCallbackUrl(request);
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientID || !clientSecret) throw new Error("El acceso con Google todavía no está configurado.");

  const fingerprint = `${clientID}\u0000${clientSecret}`;
  if (configuredClient !== fingerprint) {
    passport.use("google", createGoogleStrategy(getGoogleCallbackUrl(), createGoogleStateStore()));
    configuredClient = fingerprint;
  }
  return createGoogleStrategy(callbackURL);
}

export function createGoogleAuthorizationRequest(request: Request, state: string, nonce: string) {
  return runGooglePassport(request, ensureGoogleStrategy(request), { scope: ["email", "profile"], state, nonce });
}

export function completeGoogleAuthorization(request: Request) {
  return runGooglePassport(request, ensureGoogleStrategy(request), {});
}

function runGooglePassport(request: Request, strategy: GoogleOidcStrategy, options: Record<string, unknown>): Promise<PassportResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers.entries());
    const passportRequest = {
      method: request.method,
      url: `${url.pathname}${url.search}`,
      originalUrl: `${url.pathname}${url.search}`,
      headers,
      query: Object.fromEntries(url.searchParams.entries()),
      body: {},
      connection: { encrypted: url.protocol === "https:" }
    };
    let settled = false;
    const finish = (result: PassportResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const responseHeaders = new Map<string, string>();
    const passportResponse = {
      statusCode: 302,
      setHeader(name: string, value: string | string[]) {
        responseHeaders.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : value);
        return this;
      },
      getHeader(name: string) {
        return responseHeaders.get(name.toLowerCase());
      },
      end() {
        finish({ redirect: responseHeaders.get("location"), status: this.statusCode });
      }
    };

    const callback = (error: Error | null, user?: unknown | false, info?: unknown, status?: number) => {
      if (error) finish({ error });
      else finish({ user: user as GoogleUser | false | undefined, info, status });
    };
    const next = (error?: Error) => {
      if (error) finish({ error });
      else finish({ error: new Error("Passport no completó el acceso con Google.") });
    };

    try {
      passport.authenticate(strategy, { session: false, ...options }, callback)(passportRequest as never, passportResponse as never, next);
    } catch (error) {
      reject(error);
    }
  });
}

export function getGoogleStateCookieName() {
  return GOOGLE_STATE_COOKIE;
}

export function googleBaseUrl() {
  return getAuthBaseUrl();
}

export function googleRequestBaseUrl(request: Request) {
  return getRequestBaseUrl(request);
}

export function isGoogleLoginConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function isGoogleLoginStateValid(request: Request) {
  const url = new URL(request.url);
  const storedState = getCookieValue(request.headers.get("cookie") ?? undefined, GOOGLE_STATE_COOKIE);
  const [expectedState, expectedNonce] = storedState?.split(".") ?? [];
  const returnedState = url.searchParams.get("state");
  return Boolean(expectedState && expectedNonce && returnedState && safeEqual(expectedState, returnedState));
}

export function makeGoogleState() {
  return {
    state: randomBytes(32).toString("hex"),
    nonce: randomBytes(32).toString("base64url")
  };
}

export async function exchangeGoogleIdentity(request: Request) {
  const result = await completeGoogleAuthorization(request);
  if (result.error) throw result.error;
  if (!result.user) throw new Error("No pudimos validar la cuenta de Google.");
  return result.user;
}

