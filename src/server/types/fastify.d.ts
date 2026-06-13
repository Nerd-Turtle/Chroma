import type { AuthUser } from "../../shared/types/index.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}
