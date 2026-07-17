import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type {
  GeneratePkiCsrRequest,
  InstallPkiCertificateRequest,
} from "../../shared/types/index.js";
import { requireAuthenticated } from "../auth/authGuard.js";
import {
  generatePkiCsr,
  getPkiStatus,
  installPkiCertificate,
  type PkiServiceOptions,
} from "./pkiService.js";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function registerPkiRoutes(app: FastifyInstance, db: Database, options: PkiServiceOptions = {}): void {
  app.get("/api/pki/status", { preHandler: requireAuthenticated(db) }, async (_request, reply) => {
    try {
      return await getPkiStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read certificate status";
      return reply.code(500).send({ error: message });
    }
  });

  app.post("/api/pki/csr", { preHandler: requireAuthenticated(db) }, async (request, reply) => {
    const body = request.body as Partial<GeneratePkiCsrRequest>;
    if (typeof body.commonName !== "string" || body.commonName.trim() === "") {
      return reply.code(400).send({ error: "commonName is required" });
    }
    if (!isStringArray(body.dnsNames)) {
      return reply.code(400).send({ error: "dnsNames must be an array of strings" });
    }
    if (!isStringArray(body.ipAddresses)) {
      return reply.code(400).send({ error: "ipAddresses must be an array of strings" });
    }

    try {
      return await generatePkiCsr({
        commonName: body.commonName,
        dnsNames: body.dnsNames,
        ipAddresses: body.ipAddresses,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate certificate signing request";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/pki/certificate", { preHandler: requireAuthenticated(db) }, async (request, reply) => {
    const body = request.body as Partial<InstallPkiCertificateRequest>;
    if (typeof body.certificatePem !== "string" || body.certificatePem.trim() === "") {
      return reply.code(400).send({ error: "certificatePem is required" });
    }

    try {
      return await installPkiCertificate(body.certificatePem, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to install signed certificate";
      return reply.code(400).send({ error: message });
    }
  });
}
