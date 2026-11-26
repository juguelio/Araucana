import { createPublicKey, type webcrypto } from "node:crypto";
import jwt from "jsonwebtoken";

const issuer = "https://token.actions.githubusercontent.com";
const repo = "p2pdevmedia/Araucana";
export const scheduleAudience = "https://araucana.vercel.app/api/internal/airport-schedules";

// GitHub signs these claims for the running workflow. Forks, PRs, and other
// workflows in the same repository cannot submit a flight schedule.
export function isScheduleWorkflow(claims: jwt.JwtPayload) {
  return claims.repository_id === "1235708442" &&
    claims.repository === repo &&
    claims.ref === "refs/heads/main" &&
    claims.workflow_ref === repo + "/.github/workflows/airport-schedules.yml@refs/heads/main" &&
    ["workflow_dispatch", "schedule"].includes(claims.event_name) &&
    typeof claims.exp === "number";
}

export async function authenticateScheduleWorkflow(authorization: string | null) {
  const token = authorization?.match(/^Bearer ([\w.-]+)$/)?.[1];
  if (!token || token.length > 16000) return false;
  const header = jwt.decode(token, { complete: true })?.header;
  if (header?.alg !== "RS256" || !header.kid) return false;
  const response = await fetch(issuer + "/.well-known/jwks", {
    next: { revalidate: 300 }, signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("No se pudieron consultar las claves públicas de GitHub.");
  const { keys } = await response.json() as { keys: (webcrypto.JsonWebKey & { kid: string })[] };
  const key = keys.find(k => k.kid === header.kid && k.kty === "RSA" && k.use === "sig");
  if (!key) return false;
  try {
    const claims = jwt.verify(token, createPublicKey({ key, format: "jwk" }), {
      issuer, audience: scheduleAudience, algorithms: ["RS256"], maxAge: "10m"
    });
    return typeof claims !== "string" && isScheduleWorkflow(claims);
  } catch {
    return false;
  }
}
