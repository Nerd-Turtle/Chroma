import type { Database } from "better-sqlite3";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getAuthenticatedUser, SESSION_COOKIE_NAME } from "./authService.js";

export function requireAuthenticated(db: Database) {
  // OWASP Authorization: validate access on every protected request and deny invalid sessions.
  // https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#validate-the-permissions-on-every-request
  return async function authenticatedHook(request: FastifyRequest, reply: FastifyReply) {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (typeof sessionToken !== "string") {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const user = getAuthenticatedUser(db, sessionToken, !["GET", "HEAD", "OPTIONS"].includes(request.method));
    if (!user) {
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return reply.code(401).send({ error: "Authentication required" });
    }

    request.authUser = user;
  };
}
