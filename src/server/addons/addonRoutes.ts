import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import {
  autoSortAddonsForInstance,
  disableAddonForInstance,
  enableAddonForInstance,
  reorderAddonsForInstance,
} from "./addonEnablementService.js";
import {
  deleteAddonFromLibrary,
  downloadCurseForgeAddonForInstance,
  downloadCurseForgeAddonToLibrary,
  getAddonDetailForInstance,
  getAddonLibraryEditor,
  listAddonLibrary,
  listAddonsForInstance,
  selectLibraryAddonsForInstance,
  updateAddonLibraryLinks,
} from "./addonService.js";
import { getCurseForgeAddonProviderStatus, searchCurseForgeAddons } from "./curseForgeAddonProvider.js";
import { getAddonUpdateSettings, saveAddonUpdateSettings } from "./addonUpdateSettingsService.js";

function getStatusCodeForMessage(message: string): number {
  if (message === "Instance not found" || message === "Addon not found") {
    return 404;
  }

  return 400;
}

export async function registerAddonRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get("/api/addons/library", async (_request, reply) => {
    try {
      return {
        addons: listAddonLibrary(db),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.delete("/api/addons/library/:addonFileId", async (request, reply) => {
    const params = request.params as { addonFileId: string };

    try {
      await deleteAddonFromLibrary(db, params.addonFileId);
      return {
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.get("/api/addons/settings", async (_request, reply) => {
    try {
      return {
        settings: getAddonUpdateSettings(db),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.put("/api/addons/settings", async (request, reply) => {
    const body = request.body as {
      automaticChecksEnabled?: unknown;
      updateCheckFrequency?: unknown;
      updateCheckTime?: unknown;
      updateCheckWeekday?: unknown;
    };

    if (typeof body.automaticChecksEnabled !== "boolean") {
      return reply.code(400).send({ error: "automaticChecksEnabled must be a boolean" });
    }

    if (body.updateCheckFrequency !== "daily" && body.updateCheckFrequency !== "weekly") {
      return reply.code(400).send({ error: "updateCheckFrequency must be daily or weekly" });
    }

    if (typeof body.updateCheckTime !== "string" || !/^\d{2}:\d{2}$/.test(body.updateCheckTime)) {
      return reply.code(400).send({ error: "updateCheckTime must be a valid HH:MM time" });
    }

    if (
      body.updateCheckWeekday !== "monday" &&
      body.updateCheckWeekday !== "tuesday" &&
      body.updateCheckWeekday !== "wednesday" &&
      body.updateCheckWeekday !== "thursday" &&
      body.updateCheckWeekday !== "friday" &&
      body.updateCheckWeekday !== "saturday" &&
      body.updateCheckWeekday !== "sunday"
    ) {
      return reply.code(400).send({ error: "updateCheckWeekday must be a valid weekday" });
    }

    try {
      return {
        settings: saveAddonUpdateSettings(db, {
          automaticChecksEnabled: body.automaticChecksEnabled,
          updateCheckFrequency: body.updateCheckFrequency,
          updateCheckTime: body.updateCheckTime,
          updateCheckWeekday: body.updateCheckWeekday,
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.get("/api/addons/library/:addonFileId/editor", async (request, reply) => {
    const params = request.params as { addonFileId: string };

    try {
      return getAddonLibraryEditor(db, params.addonFileId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.put("/api/addons/library/:addonFileId/editor", async (request, reply) => {
    const params = request.params as { addonFileId: string };
    const body = request.body as {
      links?: unknown;
    };

    if (
      !Array.isArray(body.links) ||
      !body.links.every(
        (link) =>
          typeof link === "object" &&
          link !== null &&
          typeof (link as { instanceId?: unknown }).instanceId === "string" &&
          typeof (link as { autoUpdateEnabled?: unknown }).autoUpdateEnabled === "boolean",
      )
    ) {
      return reply.code(400).send({ error: "links must be an array of instanceId and autoUpdateEnabled values" });
    }

    try {
      return updateAddonLibraryLinks(
        db,
        params.addonFileId,
        body.links as Array<{ instanceId: string; autoUpdateEnabled: boolean }>,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.get("/api/addons/providers/curseforge/status", async (_request, reply) => {
    try {
      return {
        provider: await getCurseForgeAddonProviderStatus(db),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.get("/api/addons/providers/curseforge/search", async (request, reply) => {
    const query = request.query as {
      q?: string;
      sort?: string;
      page?: string;
      pageSize?: string;
      gameVersion?: string;
    };

    try {
      return await searchCurseForgeAddons(db, {
        ...(typeof query.q === "string" ? { q: query.q } : {}),
        ...(isCurseForgeSort(query.sort) ? { sort: query.sort } : {}),
        ...(typeof query.page === "string" ? { page: Number.parseInt(query.page, 10) } : {}),
        ...(typeof query.pageSize === "string" ? { pageSize: Number.parseInt(query.pageSize, 10) } : {}),
        ...(typeof query.gameVersion === "string" ? { gameVersion: query.gameVersion } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message === "CurseForge API key is not configured" ? 409 : getStatusCodeForMessage(message);
      return reply.code(statusCode).send({ error: message });
    }
  });

  app.post("/api/addons/providers/curseforge/download", async (request, reply) => {
    const body = request.body as { projectId?: unknown; fileId?: unknown };

    if (typeof body.projectId !== "number" || typeof body.fileId !== "number" || !Number.isInteger(body.projectId) || !Number.isInteger(body.fileId)) {
      return reply.code(400).send({ error: "projectId and fileId must be integers" });
    }

    try {
      const detail = await downloadCurseForgeAddonToLibrary(db, {
        projectId: body.projectId,
        fileId: body.fileId,
      });
      return reply.code(201).send(detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message === "CurseForge API key is not configured" ? 409 : getStatusCodeForMessage(message);
      return reply.code(statusCode).send({ error: message });
    }
  });

  app.get("/api/instances/:instanceId/addons", async (request, reply) => {
    const params = request.params as { instanceId: string };

    try {
      return {
        addons: listAddonsForInstance(db, params.instanceId),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.post("/api/instances/:instanceId/addons/library", async (request, reply) => {
    const params = request.params as { instanceId: string };
    const body = request.body as { addonFileIds?: unknown };

    if (!Array.isArray(body.addonFileIds) || !body.addonFileIds.every((addonFileId) => typeof addonFileId === "string")) {
      return reply.code(400).send({ error: "addonFileIds must be an array of strings" });
    }

    try {
      return selectLibraryAddonsForInstance(db, params.instanceId, body.addonFileIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.put("/api/instances/:instanceId/addons/order", async (request, reply) => {
    const params = request.params as { instanceId: string };
    const body = request.body as { addonIds?: unknown };

    if (!Array.isArray(body.addonIds) || !body.addonIds.every((addonId) => typeof addonId === "string")) {
      return reply.code(400).send({ error: "addonIds must be an array of strings" });
    }

    try {
      return await reorderAddonsForInstance(db, params.instanceId, body.addonIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.post("/api/instances/:instanceId/addons/auto-sort", async (request, reply) => {
    const params = request.params as { instanceId: string };

    try {
      return await autoSortAddonsForInstance(db, params.instanceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.get("/api/instances/:instanceId/addons/providers/curseforge/status", async (request, reply) => {
    const params = request.params as { instanceId: string };

    try {
      listAddonsForInstance(db, params.instanceId);
      return {
        provider: await getCurseForgeAddonProviderStatus(db),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.get("/api/instances/:instanceId/addons/providers/curseforge/search", async (request, reply) => {
    const params = request.params as { instanceId: string };
    const query = request.query as {
      q?: string;
      sort?: string;
      page?: string;
      pageSize?: string;
      gameVersion?: string;
    };

    try {
      listAddonsForInstance(db, params.instanceId);
      return await searchCurseForgeAddons(db, {
        ...(typeof query.q === "string" ? { q: query.q } : {}),
        ...(isCurseForgeSort(query.sort) ? { sort: query.sort } : {}),
        ...(typeof query.page === "string" ? { page: Number.parseInt(query.page, 10) } : {}),
        ...(typeof query.pageSize === "string" ? { pageSize: Number.parseInt(query.pageSize, 10) } : {}),
        ...(typeof query.gameVersion === "string" ? { gameVersion: query.gameVersion } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message === "CurseForge API key is not configured" ? 409 : getStatusCodeForMessage(message);
      return reply.code(statusCode).send({ error: message });
    }
  });

  app.post("/api/instances/:instanceId/addons/providers/curseforge/download", async (request, reply) => {
    const params = request.params as { instanceId: string };
    const body = request.body as { projectId?: unknown; fileId?: unknown };

    if (typeof body.projectId !== "number" || typeof body.fileId !== "number" || !Number.isInteger(body.projectId) || !Number.isInteger(body.fileId)) {
      return reply.code(400).send({ error: "projectId and fileId must be integers" });
    }

    try {
      const detail = await downloadCurseForgeAddonForInstance(db, params.instanceId, {
        projectId: body.projectId,
        fileId: body.fileId,
      });
      return reply.code(201).send(detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message === "CurseForge API key is not configured" ? 409 : getStatusCodeForMessage(message);
      return reply.code(statusCode).send({ error: message });
    }
  });

  app.get("/api/instances/:instanceId/addons/:addonId", async (request, reply) => {
    const params = request.params as { instanceId: string; addonId: string };

    try {
      return getAddonDetailForInstance(db, params.instanceId, params.addonId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.post("/api/instances/:instanceId/addons/:addonId/enable", async (request, reply) => {
    const params = request.params as { instanceId: string; addonId: string };

    try {
      return await enableAddonForInstance(db, params.instanceId, params.addonId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });

  app.post("/api/instances/:instanceId/addons/:addonId/disable", async (request, reply) => {
    const params = request.params as { instanceId: string; addonId: string };

    try {
      return await disableAddonForInstance(db, params.instanceId, params.addonId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(getStatusCodeForMessage(message)).send({ error: message });
    }
  });
}

function isCurseForgeSort(value: unknown): value is "relevance" | "popularity" | "last_updated" | "total_downloads" | "released_date" | "rating" {
  return (
    value === "relevance" ||
    value === "popularity" ||
    value === "last_updated" ||
    value === "total_downloads" ||
    value === "released_date" ||
    value === "rating"
  );
}
