import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { AuthSessionResponse, LoginRequest, LoginResponse } from "../../shared/types/index.js";
import { PasswordHashBusyError } from "./passwords.js";
import { requireAuthenticated } from "./authGuard.js";
import { isSetupComplete } from "../setup/setupService.js";
import { getAuthenticatedUser, InvalidCredentialsError, loginWithPassword, logoutSession, SESSION_COOKIE_NAME } from "./authService.js";

export function registerAuthRoutes(app: FastifyInstance, db: Database): void {
  app.post("/api/auth/activity", { preHandler: requireAuthenticated(db) }, async () => ({ success: true }));

  app.post("/api/auth/login", { bodyLimit: 16 * 1024 }, async (request, reply) => {
    if (!isSetupComplete(db)) {
      return reply.code(400).send({ error: "Setup is not complete" });
    }

    const body = (request.body ?? {}) as Partial<LoginRequest>;
    if (typeof body.username !== "string" || body.username.trim() === "" || body.username.trim().length > 64) {
      return reply.code(400).send({ error: "username must be 1-64 characters" });
    }

    if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 1024) {
      return reply.code(400).send({ error: "password must be 8-1024 characters" });
    }

    try {
      const result = await loginWithPassword(db, body.username.trim(), body.password);
      // OWASP Session Management: HttpOnly limits script access; Secure protects transport;
      // SameSite reduces cross-site cookie sending (it is not a complete CSRF defense).
      // https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies
      reply.setCookie(SESSION_COOKIE_NAME, result.sessionToken, {
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
      if (error instanceof PasswordHashBusyError) return reply.header("Retry-After", 5).code(429).send({ error: error.message });
      if (error instanceof InvalidCredentialsError) return reply.code(401).send({ error: error.message });
      request.log.error({ err: error }, "Authentication failed internally");
      return reply.code(500).send({ error: "Unable to sign in. Please try again." });
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (typeof sessionToken === "string") {
      logoutSession(db, sessionToken);
    }

    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return { success: true };
  });

  app.get("/api/auth/session", async (request, reply): Promise<AuthSessionResponse> => {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (typeof sessionToken !== "string") {
      return { authenticated: false };
    }

    const user = getAuthenticatedUser(db, sessionToken);
    if (!user) {
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return { authenticated: false };
    }

    return {
      authenticated: true,
      user,
    };
  });
}
