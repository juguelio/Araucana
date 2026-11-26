import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, expect, it, vi } from "vitest";
import { authenticateScheduleWorkflow, scheduleAudience } from "./schedule-workflow";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const claims = {
  repository_id: "1235708442", repository: "p2pdevmedia/Araucana", ref: "refs/heads/main",
  workflow_ref: "p2pdevmedia/Araucana/.github/workflows/airport-schedules.yml@refs/heads/main",
  event_name: "schedule"
};

afterEach(() => vi.unstubAllGlobals());

it.each([
  [claims, true],
  [{ ...claims, repository_id: "123" }, false],
  [{ ...claims, ref: "refs/heads/feature" }, false],
  [{ ...claims, workflow_ref: "p2pdevmedia/Araucana/.github/workflows/other.yml@refs/heads/main" }, false],
  [{ ...claims, event_name: "pull_request_target" }, false]
])("valida la identidad firmada del workflow de producción", async (payload, accepted) => {
  const key = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig" };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [key] })));
  const token = jwt.sign(payload, privateKey, {
    algorithm: "RS256", issuer: "https://token.actions.githubusercontent.com",
    audience: scheduleAudience, keyid: "test-key", expiresIn: "5m"
  });
  expect(await authenticateScheduleWorkflow("Bearer " + token)).toBe(accepted);
});
