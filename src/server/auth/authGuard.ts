import type { Database } from "better-sqlite3";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getAuthenticatedUser, SESSION_COOKIE_NAME } from "./authService.js";

export function requireAuthenticated(db: Database) {
  return async function authenticatedHook(request: FastifyRequest, reply: FastifyReply) {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (typeof sessionId !== "string") {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const user = getAuthenticatedUser(db, sessionId);
    if (!user) {
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return reply.code(401).send({ error: "Authentication required" });
    }

    request.authUser = user;
  };
}
