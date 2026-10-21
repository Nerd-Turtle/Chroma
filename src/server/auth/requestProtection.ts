import type { FastifyInstance } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function registerRequestProtection(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.routeOptions.url?.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    if (SAFE_METHODS.has(request.method)) return;

    // OWASP CSRF Prevention / Custom Request Headers for AJAX/API: require this even
    // for bodyless actions, login/setup and multipart uploads. Keep CORS disabled;
    // otherwise an untrusted origin could pass the browser's custom-header preflight.
    // https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi
    const site = request.headers["sec-fetch-site"];
    if (request.headers["x-chroma-request"] !== "1" || site === "cross-site" || site === "same-site") {
      return reply.code(403).send({ error: "Same-origin API request required" });
    }

    // OWASP CSRF Prevention / Using Standard Headers to Verify Origin: compare full
    // origins, including scheme/port, never suffixes. Fetch Metadata rejects sibling sites.
    // https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#using-standard-headers-to-verify-origin
    // Direct HTTPS hosting is the production model. Do not trust client Forwarded headers.
    // When browser origin headers are absent, the mandatory custom header is the defense.
    const origin = request.headers.origin;
    const referer = request.headers.referer;
    if (origin !== undefined || referer !== undefined) {
      try {
        const target = new URL(`${request.protocol}://${request.host}`).origin;
        const source = new URL(origin ?? referer!);
        if (source.origin === "null" || source.origin !== target ||
          (origin !== undefined && origin !== source.origin)) throw new Error("Untrusted origin");
      } catch {
        return reply.code(403).send({ error: "Same-origin API request required" });
      }
    }
  });
}
