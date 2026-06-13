import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { isSetupComplete } from "../setup/setupService.js";
import { loginUser, logoutSession, getAuthUserFromSession } from "./authService.js";

const SESSION_COOKIE_NAME = "chroma_session";

export function registerAuthRoutes(app: FastifyInstance, db: Database) {
  app.post("/api/auth/login", async (request, reply) => {
    if (!isSetupComplete(db)) {
      return reply.code(400).send({ error: "Setup is not complete" });
    }

    const body = request.body as { username?: unknown; password?: unknown };
    if (typeof body.username !== "string" || body.username.trim() === "") {
      return reply.code(400).send({ error: "username is required" });
    }
    if (typeof body.password !== "string" || body.password.length < 8) {
      return reply.code(400).send({ error: "password is required and must be at least 8 characters" });
    }

    try {
      const { user, sessionId } = await loginUser(db, body.username.trim(), body.password);
      reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      });
      return { authenticated: true, user };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(401).send({ error: message });
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (typeof sessionId === "string") {
      logoutSession(db, sessionId);
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return { success: true };
  });

  app.get("/api/auth/session", async (request) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (typeof sessionId !== "string") {
      return { authenticated: false };
    }

    const user = getAuthUserFromSession(db, sessionId);
    if (!user) {
      return { authenticated: false };
    }

    return { authenticated: true, user };
  });
}
