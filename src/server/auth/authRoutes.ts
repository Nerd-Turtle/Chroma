import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { AuthSessionResponse, LoginRequest, LoginResponse } from "../../shared/types/index.js";
import { isSetupComplete } from "../setup/setupService.js";
import { getAuthenticatedUser, loginWithPassword, logoutSession, SESSION_COOKIE_NAME } from "./authService.js";

export function registerAuthRoutes(app: FastifyInstance, db: Database): void {
  app.post("/api/auth/login", async (request, reply) => {
    if (!isSetupComplete(db)) {
      return reply.code(400).send({ error: "Setup is not complete" });
    }

    const body = request.body as Partial<LoginRequest>;
    if (typeof body.username !== "string" || body.username.trim() === "") {
      return reply.code(400).send({ error: "username is required" });
    }

    if (typeof body.password !== "string" || body.password.length < 8) {
      return reply.code(400).send({ error: "password must be at least 8 characters" });
    }

    try {
      const result = await loginWithPassword(db, body.username.trim(), body.password);
      reply.setCookie(SESSION_COOKIE_NAME, result.sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        expires: result.expiresAt,
      });

      const response: LoginResponse = {
        authenticated: true,
        user: result.user,
      };
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
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

  app.get("/api/auth/session", async (request): Promise<AuthSessionResponse> => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (typeof sessionId !== "string") {
      return { authenticated: false };
    }

    const user = getAuthenticatedUser(db, sessionId);
    if (!user) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      user,
    };
  });
}
