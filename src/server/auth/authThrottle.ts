import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";

const WINDOW_MS = 5 * 60_000;
const MAX_BUCKETS = 4096;
type Bucket = { count: number; resetAt: number };

function reject(reply: FastifyReply, seconds: number) {
  return reply.header("Retry-After", Math.max(1, seconds)).code(429).send({
    error: `Too many authentication attempts. Try again in ${Math.max(1, seconds)} seconds.`,
  });
}

export function registerAuthenticationThrottle(app: FastifyInstance): void {
  // OWASP Authentication / Login Throttling: combine account, source and total budgets.
  // Count all attempts (including concurrent ones), without disclosing account existence.
  // https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#login-throttling
  // This single-server, bounded in-memory limiter resets when Chroma restarts.
  const buckets = new Map<string, Bucket>();
  function consume(key: string, limit: number, reply: FastifyReply): boolean {
    const now = Date.now();
    for (const [name, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(name);
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      // Do not evict live counters: changing usernames/IPs must not bypass the limit.
      if (buckets.size >= MAX_BUCKETS) { reject(reply, 300); return false; }
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      reject(reply, Math.ceil((bucket.resetAt - now) / 1000));
      return false;
    }
    bucket.count++;
    return true;
  }

  app.addHook("onRequest", async (request, reply) => {
    const path = request.routeOptions.url;
    if (request.method !== "POST" || (path !== "/api/auth/login" && path !== "/api/setup/complete")) return;
    const scope = path === "/api/auth/login" ? "login" : "setup";
    if (!consume(`${scope}:total`, scope === "login" ? 60 : 10, reply)) return reply;
    // Fastify's default trustProxy=false uses the actual peer, not spoofed Forwarded headers.
    if (!consume(`${scope}:ip:${request.ip}`, scope === "login" ? 10 : 5, reply)) return reply;
  });
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST" || request.routeOptions.url !== "/api/auth/login") return;
    const body = request.body as { username?: unknown } | null;
    if (typeof body?.username !== "string" || body.username.trim().length > 64) return;
    const key = createHash("sha256").update(body.username.trim()).digest("hex");
    if (!consume(`login:account:${key}`, 5, reply)) return reply;
  });
  app.addHook("onClose", async () => buckets.clear());
}
