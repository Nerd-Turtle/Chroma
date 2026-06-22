# Chroma Addons Roadmap

## Overall Objective

Build instance-scoped Bedrock addon management into Chroma so an operator can:

- browse and search supported addon providers from the Web UI
- download selected Bedrock addons into the instance-managed addon workspace
- inspect which packs were discovered inside each addon archive
- enable or disable addons without manually editing BDS files
- keep downloaded addon files, enabled BDS pack folders, world pack references, logs, and backups scoped to one instance

The first provider target is CurseForge. The first supported game target is Minecraft Bedrock addons for Bedrock Dedicated Server instances.

## Current Baseline

Relevant existing project shape:

- New instances already create:
  - `bds/`
  - `bds/worlds/`
  - `bds/behavior_packs/`
  - `bds/resource_packs/`
  - `csm/addons/`
- The instance workspace already has an `Addons` tab placeholder in:
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
- Runtime and maintenance events already exist through:
  - [src/server/instances/instanceRuntimeEventService.ts](/home/turtle/chroma/src/server/instances/instanceRuntimeEventService.ts)
- Internal backups currently capture BDS config and worlds through:
  - [src/server/instances/instanceBackupService.ts](/home/turtle/chroma/src/server/instances/instanceBackupService.ts)

This means addon work should fit into the current instance model rather than creating a separate top-level product area.

## Terms

- Addon: the Chroma-level record for something the user downloaded for one instance.
- Provider project: a project from an external provider such as CurseForge.
- Provider file: a specific downloadable file/release from a provider project.
- Pack: a Bedrock behavior pack or resource pack discovered inside an addon archive.
- Downloaded: Chroma has stored the provider file in the instance's `csm/addons` workspace and parsed its packs.
- Enabled: Chroma has imported the addon packs into BDS and referenced them from the active world's pack JSON files.
- Imported: copied from the Chroma addon workspace into `bds/behavior_packs` or `bds/resource_packs`.

CurseForge API docs use "mods" broadly. Chroma should use "addons" in UI and shared types because the product is managing Bedrock addons, not Java Edition mods.

## Core Product Model

Addons belong to an instance.

Each instance has two addon-related filesystem zones:

- `csm/addons`: Chroma-managed addon workspace. This is the source of truth for downloaded archives and parsed metadata.
- `bds/behavior_packs`, `bds/resource_packs`, and `bds/worlds/<world>`: generated BDS runtime state when addons are enabled.

The BDS folders should be treated as generated state owned by Chroma for Chroma-managed addons. Users should not need to edit those files manually during normal use.

## Key Design Decisions

### 1. Copy packs on enable

Use copy-based import for the initial implementation.

Reasons:

- simpler mental model while learning
- safer backup/export behavior
- avoids symlink surprises with BDS and Linux service users
- easier to validate path ownership before delete/disable
- avoids exposing BDS to symlinked untrusted archive content

Symlinks can be reconsidered later if disk usage becomes painful.

### 2. Downloaded and enabled are separate states

Downloading an addon does not change BDS behavior.

Enabling an addon:

- requires parsed behavior/resource pack metadata
- copies pack folders into the BDS pack directories
- updates the active world's pack JSON files
- records enabled paths and timestamps in SQLite
- appends an instance runtime event

Disabling an addon:

- removes Chroma-managed entries from world pack JSON files
- removes only Chroma-owned imported pack folders
- leaves the downloaded addon workspace intact

### 3. Do not enable while BDS is running in v1

For the first implementation, addon enable/disable should require the instance to be stopped.

Later, Chroma can support a managed maintenance flow that warns players, stops BDS, applies addon changes, and restarts BDS. The first slice should keep this explicit and easier to test.

### 4. Treat addon archives as untrusted input

Archive extraction must validate every path.

Rules:

- reject absolute paths
- reject `..` traversal
- reject entries that resolve outside the intended extraction directory
- do not follow symlinks from archives
- set a reasonable maximum archive size and extracted file count before broad release
- parse JSON with structured validation before trusting manifest fields

The BDS zip extraction service already has useful path traversal patterns that can be reused or generalized.

### 5. Keep provider secrets server-side

CurseForge API access requires an approved CurseForge API key.

CurseForge API keys must never be sent to React.

The backend should call CurseForge and return only Chroma-shaped search results to the browser.

Normal configuration should be Web UI based:

- Initial setup includes an optional CurseForge API key field.
- Post-install Settings includes add, replace, and remove actions for the CurseForge API key.
- The backend stores the key as a server-side application setting.
- API responses expose only whether a key is configured and, at most, a short redacted hint such as the last four characters.
- Logs, browser bundles, and provider status responses must never include the full key.

If the key is missing, the Addons tab should still load and show that CurseForge browsing is not configured.

### 6. Do not hard-code CurseForge Bedrock IDs until verified

CurseForge search needs a game ID and likely a class/category filter for Bedrock addons.

The provider service should prefer discovery:

1. call the CurseForge games/categories endpoints available to the key
2. find the game slug/name for Minecraft Bedrock
3. find the class/category for Addons
4. cache the resolved IDs in memory

If discovery is unclear, Chroma should add non-secret Settings fields for the resolved Bedrock game/class IDs rather than requiring normal users to edit environment files.

### 7. Search ranking starts simple

The CurseForge API exposes useful sort fields, including popularity, last updated, total downloads, release date, and rating.

MVP search should map Chroma UI sort options to provider sort fields.

Custom ranking can come later by fetching a bounded number of pages and scoring locally. Do not fetch huge result sets in the first pass.

### 8. Provider download URLs may fail or be unavailable

CurseForge has a specific "download URL" endpoint for a mod/project file. Chroma should use that endpoint instead of scraping the website.

Some provider files may not be available for direct third-party download. Chroma should surface that as a clear provider limitation, not as a generic install failure.

## Proposed Files

Shared types:

- `src/shared/types/addon.ts`
- export from `src/shared/types/index.ts`

Backend:

- `src/server/addons/addonRoutes.ts`
- `src/server/addons/addonService.ts`
- `src/server/addons/addonRepository.ts`
- `src/server/addons/addonArchiveService.ts`
- `src/server/addons/addonEnablementService.ts`
- `src/server/addons/curseForgeClient.ts`
- `src/server/addons/curseForgeAddonProvider.ts`

Frontend:

- extend `src/web/src/api/chromaApi.ts`
- extend the existing Addons tab in `src/web/src/pages/InstancesPage.tsx`
- add CSS in `src/web/src/styles.css`

Future CLI:

- CLI should call the same backend service logic where practical.
- Do not duplicate archive parsing or enablement rules between server and CLI.

## Filesystem Layout

Suggested instance workspace layout:

```text
<instancePath>/
  csm/
    addons/
      curseforge-<projectId>/
        addon.json
        files/
          <fileId>/
            <original-file-name>
        extracted/
          <fileId>/
            ...
  bds/
    behavior_packs/
      chroma_<packUuid>_<version>/
        manifest.json
        ...
    resource_packs/
      chroma_<packUuid>_<version>/
        manifest.json
        ...
    worlds/
      <activeWorldName>/
        world_behavior_packs.json
        world_resource_packs.json
```

Naming notes:

- Use provider IDs for the Chroma workspace path when available.
- Use pack UUID and version for imported BDS pack folder names.
- Sanitize all user/provider-facing names before using them in paths.
- Store exact paths in SQLite so disable can remove only paths Chroma created.
- Do not overwrite an existing BDS pack folder unless it is already recorded as owned by the same addon pack.

## SQLite Model

### `instance_addons`

One row per downloaded provider file for an instance.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `instance_id TEXT NOT NULL`
- `provider TEXT NOT NULL`
- `provider_project_id TEXT NOT NULL`
- `provider_file_id TEXT NOT NULL`
- `name TEXT NOT NULL`
- `slug TEXT`
- `summary TEXT`
- `website_url TEXT`
- `logo_url TEXT`
- `file_name TEXT`
- `file_display_name TEXT`
- `file_date TEXT`
- `download_count INTEGER`
- `status TEXT NOT NULL`
- `workspace_path TEXT NOT NULL`
- `archive_path TEXT`
- `extracted_path TEXT`
- `provider_metadata_json TEXT`
- `error TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Suggested statuses:

- `downloaded`
- `enabled`
- `disabled`
- `error`

The addon status can be derived from pack statuses later. For the first implementation, keep a denormalized status to make UI listing simple.

### `instance_addon_packs`

One row per behavior/resource pack discovered inside an addon archive.

Suggested columns:

- `id TEXT PRIMARY KEY`
- `instance_id TEXT NOT NULL`
- `addon_id TEXT NOT NULL`
- `pack_type TEXT NOT NULL`
- `name TEXT`
- `description TEXT`
- `header_uuid TEXT NOT NULL`
- `header_version_json TEXT NOT NULL`
- `min_engine_version_json TEXT`
- `source_path TEXT NOT NULL`
- `enabled_path TEXT`
- `status TEXT NOT NULL`
- `enabled_at TEXT`
- `disabled_at TEXT`
- `manifest_json TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Suggested pack types:

- `behavior`
- `resource`
- `unknown`

Suggested pack statuses:

- `downloaded`
- `enabled`
- `disabled`
- `unsupported`
- `error`

Add indexes:

- `(instance_id, provider, provider_project_id, provider_file_id)` unique on `instance_addons`
- `(instance_id, header_uuid, header_version_json, pack_type)` on `instance_addon_packs`
- `(addon_id)` on `instance_addon_packs`

## Bedrock Manifest Rules

For each candidate pack folder:

1. Find `manifest.json` directly inside the pack root.
2. Parse JSON.
3. Require `header.uuid` as a UUID-like string.
4. Require `header.version` as a three-number array.
5. Classify pack type from module types:
   - `resources` means resource pack
   - `data` or `script` means behavior pack
6. Store `dependencies` for future use, but do not try to auto-resolve external dependencies in the first slice.
7. Compare `min_engine_version` with the instance BDS version when possible. Warn if it appears incompatible, but do not overfit this until real fixtures prove the behavior.

Unknown pack types should be visible in the UI as unsupported rather than silently ignored.

## Archive Handling

Supported initial inputs from CurseForge:

- `.mcpack`
- `.mcaddon`
- `.zip`

Extraction behavior:

- A zip with `manifest.json` at root is one pack.
- A zip with top-level folders containing `manifest.json` may contain multiple packs.
- A `.mcaddon` may contain nested `.mcpack` files. Support one level of nested pack archives, using the same path safety rules.
- Do not recurse through arbitrary nested archives.
- Keep the original downloaded archive.
- Keep the extracted workspace until uninstall.

Validation failures should mark the addon as `error` and keep enough metadata for troubleshooting.

## Enable Flow

Preconditions:

- instance exists
- BDS install exists
- active world can be resolved
- BDS is stopped
- addon is downloaded and has at least one supported pack
- no other enabled Chroma addon owns the same pack UUID/version/type unless it is the same addon

Steps:

1. Load addon and pack rows.
2. Resolve active world path under `<instancePath>/bds/worlds`.
3. Create an internal revert backup before modifying world pack JSON files.
4. For each behavior pack:
   - copy source folder to `bds/behavior_packs/chroma_<uuid>_<version>`
   - record `enabled_path`
   - add `{ "pack_id": "<uuid>", "version": [x, y, z] }` to `world_behavior_packs.json`
5. For each resource pack:
   - copy source folder to `bds/resource_packs/chroma_<uuid>_<version>`
   - record `enabled_path`
   - add `{ "pack_id": "<uuid>", "version": [x, y, z] }` to `world_resource_packs.json`
6. Avoid duplicate JSON entries.
7. Save DB changes.
8. Append an instance runtime event.
9. Return the updated addon detail.

If any step fails after files were changed, attempt rollback from the internal backup and report the original error.

## Disable Flow

Preconditions:

- instance exists
- BDS is stopped
- addon has enabled packs

Steps:

1. Create an internal revert backup.
2. Remove matching pack entries from the active world's pack JSON files.
3. Remove imported pack folders only if the paths are recorded in DB and are under the expected BDS pack directory.
4. Mark pack rows as `disabled`.
5. Mark addon as `disabled` if no packs remain enabled.
6. Append an instance runtime event.

Downloaded archives and extracted workspace files stay in `csm/addons`.

## API Shape

Routes should be registered under the existing authenticated instance route tree.

Suggested endpoints:

- `GET /api/instances/:instanceId/addons`
  - list downloaded addons for an instance
- `GET /api/instances/:instanceId/addons/:addonId`
  - addon detail, including discovered packs
- `GET /api/instances/:instanceId/addons/providers/curseforge/status`
  - whether CurseForge is configured and which IDs were resolved
- `GET /api/instances/:instanceId/addons/providers/curseforge/search`
  - query params: `q`, `sort`, `page`, `pageSize`, `gameVersion`
- `POST /api/instances/:instanceId/addons/providers/curseforge/download`
  - body: `projectId`, `fileId`
- `POST /api/instances/:instanceId/addons/:addonId/enable`
- `POST /api/instances/:instanceId/addons/:addonId/disable`

Route handlers should validate HTTP input and delegate to services.

## CurseForge Provider Details

Official docs:

- REST API: https://docs.curseforge.com/rest-api/
- API key process: https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key

Important behavior from the current docs:

- Base URL is `https://api.curseforge.com`.
- Authentication uses an `x-api-key` header.
- Page size is limited to 50 results.
- Search, mod/project detail, file listing, and file download URL endpoints are available.
- Sort fields include featured, popularity, last updated, total downloads, released date, and rating.

Chroma provider behavior:

- Backend reads the CurseForge API key from server-side application settings.
- Initial setup and post-install Settings are the supported user-facing configuration paths.
- Backend returns a provider status object if the key is missing.
- Backend maps Chroma sort labels to CurseForge sort fields.
- Backend should use the provider download URL endpoint instead of scraping `curseforge.com`.
- Backend should persist provider metadata in `provider_metadata_json`, but expose only the fields the UI needs.

## Web UI

The initial Addons tab should include:

- installed/downloaded addon table
- status column: Downloaded, Enabled, Error, Unsupported
- provider column
- selected file/version/date where available
- pack count summary: behavior/resource/unsupported
- Enable and Disable buttons
- clear disabled state when the instance is running
- provider configuration warning if CurseForge key is missing
- Browse CurseForge action

The CurseForge browse UI should include:

- search input
- sort menu
- optional game version filter defaulted from the instance BDS version when known
- results table/list with name, author, downloads, updated date, rating if available
- Download action

Keep the UI operational and compact. This is an instance management workspace, not a marketing page.

## Manual Validation Matrix

Add a dedicated addon validation doc later, or extend this section as phases land.

Initial manual cases:

1. Missing CurseForge key
   - Addons tab loads
   - Browse action explains that provider configuration is missing
2. CurseForge search
   - query returns Bedrock addon-looking results
   - sort changes result ordering
   - API key is never visible in browser responses
3. Download valid addon
   - archive appears under `csm/addons`
   - DB rows are created
   - packs are detected from `manifest.json`
4. Reject malicious archive
   - path traversal archive is rejected
   - no file appears outside the addon workspace
5. Enable while stopped
   - packs copy into BDS directories
   - world pack JSON files are created or updated
   - runtime event is recorded
6. Enable while running
   - request is blocked with a clear message
   - no files are changed
7. Disable
   - world pack JSON entries are removed
   - Chroma-owned imported pack folders are removed
   - downloaded workspace remains
8. Duplicate pack conflict
   - enabling a second addon with same UUID/version/type is blocked or clearly handled
9. Backup behavior
   - an internal backup is created before enable/disable changes
10. Build validation
   - `pnpm typecheck`
   - `pnpm build`

## Phase Tracking Convention

As each phase is implemented, append:

- `Implementation Notes`
- `Validation Notes`
- `Status`

## Phase 1: Addon Data Model and Read-Only UI Shell

### Objective

Create the shared addon model, SQLite tables, repository functions, list routes, and a real Addons tab shell.

### Scope

- Add shared addon types.
- Add addon tables and indexes.
- Add repository functions for list/detail.
- Add `GET /api/instances/:instanceId/addons`.
- Replace the placeholder Addons tab with a table empty state.
- Do not implement CurseForge calls yet.
- Do not implement download or enablement yet.

### Validation Rules

- Existing instances continue to load.
- Addons tab loads for an instance with no addons.
- TypeScript catches shared type mismatches between backend and frontend.

## Phase 2: CurseForge Provider Configuration and Search

### Objective

Add backend-only CurseForge integration for provider status and search.

### Scope

- Add `curseForgeClient`.
- Read the CurseForge API key only on the backend from application settings.
- Add provider status route.
- Resolve or configure Bedrock game/class IDs.
- Add search route.
- Add Browse CurseForge UI.
- Map UI sort options to provider sort fields.
- Do not download files yet.

### Validation Rules

- Missing API key is handled gracefully.
- Search requests never expose the API key.
- Result shape is stable and provider-specific details stay behind shared Chroma types.

## Phase 3: Download and Archive Inspection

### Objective

Download a selected CurseForge file into the instance addon workspace and parse its Bedrock packs.

### Scope

- Add download route.
- Use CurseForge file download URL endpoint.
- Store original archive.
- Extract into `csm/addons`.
- Parse manifests.
- Insert `instance_addons` and `instance_addon_packs` rows.
- Show downloaded addons and pack summaries in UI.

### Validation Rules

- Valid `.mcpack`, `.mcaddon`, and `.zip` samples can be parsed.
- Unsupported or malformed archives become visible errors.
- Path traversal fixtures cannot write outside `csm/addons`.

## Phase 4: Enable and Disable Addons

### Objective

Make downloaded addons active or inactive for the selected instance's active world.

### Scope

- Add enable route.
- Add disable route.
- Require BDS stopped.
- Resolve active world safely.
- Create internal backup before changes.
- Copy behavior/resource packs into BDS directories.
- Update world pack JSON files.
- Remove Chroma-owned imported folders on disable.
- Record runtime events.

### Validation Rules

- Enable modifies only the selected instance.
- Disable leaves the downloaded addon workspace intact.
- Running instances block addon changes.
- Internal backup exists before world JSON changes.

## Phase 5: Provider-Aware Update Checks

### Objective

Let Chroma tell whether a downloaded CurseForge addon has a newer file available.

### Scope

- Query provider files for an existing project.
- Compare current `provider_file_id` and file dates.
- Surface update availability in the Addons table.
- Do not auto-update addons in this phase.

### Validation Rules

- Existing downloaded addons can show Current, Update Available, or Unknown.
- Provider failures do not break local addon management.

## Phase 6: Managed Maintenance Flow

### Objective

Allow enable/disable while an instance is running by using the existing runtime maintenance model.

### Scope

- Warn players through console command when possible.
- Stop BDS.
- Apply addon change.
- Restart BDS if it was previously running.
- Surface progress in runtime state/events.

### Validation Rules

- Failed enablement does not leave BDS falsely marked as healthy.
- Previously running instances are restarted only after successful changes.
- Operator can see exactly what happened in recent activity.

## Open Questions

- What exact game ID and addon class/category ID will CurseForge expose for the approved API key?
- How often do Bedrock `.mcaddon` files from CurseForge use nested `.mcpack` files versus top-level BP/RP folders?
- Should resource packs automatically toggle `texturepack-required`, or should that stay as a separate server setting?
- Should addon pack dependencies block enablement, warn only, or prompt the user?
- Should uninstall delete the original archive, extracted workspace, or both?
- Should Chroma support local manual addon upload before or after CurseForge download?

## Do Not Do Yet

- Do not add Java Edition mod loader support.
- Do not add automated test frameworks solely for addons.
- Do not scrape CurseForge web pages for downloads.
- Do not support arbitrary external download URLs from API input.
- Do not silently edit addons while BDS is running.
- Do not implement auto-updating addons until manual download/enable/disable is reliable.
