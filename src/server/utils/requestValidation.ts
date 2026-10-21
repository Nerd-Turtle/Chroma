import type { FastifyError, FastifyInstance } from "fastify";
import { isJsonObject } from "../../shared/validation.js";

export function registerRequestValidation(app: FastifyInstance): void {
  app.addHook("preValidation", async (request, reply) => {
    if (!request.routeOptions.url?.startsWith("/api/")) return;
    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (request.body !== undefined && contentType !== "application/json" && contentType !== "multipart/form-data") {
      return reply.code(415).send({ error: "Request body must use application/json or multipart/form-data" });
    }
    // RFC 8259 permits null/arrays/primitives as JSON; our API bodies require objects.
    // A TypeScript assertion does not validate input at runtime. Multipart stays separate.
    // https://www.rfc-editor.org/rfc/rfc8259.html#section-3
    if (contentType === "application/json" && !isJsonObject(request.body)) {
      return reply.code(400).send({ error: "Request body must be a JSON object" });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    // RFC 9110: invalid input is 4xx; unexpected server failures are 500, with details
    // retained in server logs rather than exposed to clients.
    // https://www.rfc-editor.org/rfc/rfc9110.html#section-15
    const failure = error instanceof Error ? error as FastifyError : undefined;
    const status = typeof failure?.statusCode === "number" ? failure.statusCode : 500;
    if (status >= 400 && status < 500) {
      const message = failure?.code === "FST_ERR_CTP_INVALID_JSON_BODY" ? "Request body must contain valid JSON" : failure?.message ?? "Request rejected";
      return reply.code(status).send({ error: message });
    }
    request.log.error({ err: error }, "Unexpected API error");
    return reply.code(500).send({ error: "An unexpected server error occurred. Please try again." });
  });
}
