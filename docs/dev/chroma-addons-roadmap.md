# Chroma Addons Roadmap

## Overall Objective

Build Bedrock addon management into Chroma so an operator can:

- browse and search supported addon providers from the Web UI
- download selected Bedrock addons into Chroma-managed storage
- inspect which packs were discovered inside each addon archive
- enable or disable downloaded addons for specific instances without manually editing BDS files
- keep enabled BDS pack folders, world pack references, logs, and backups scoped to one instance
- eventually track downloaded addon versions centrally for update checks, retention, and revert capability

The first provider target is CurseForge. The first supported game target is Minecraft Bedrock addons for Bedrock Dedicated Server instances.

## Current Baseline

Relevant existing project shape:

- New instances already create:
  - `bds/`
  - `bds/worlds/`
  - `bds/behavior_packs/`
  - `bds/resource_packs/`
- The instance workspace has an internal `Addons` tab in:
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
- The Web UI has a top-level `Addon Library` page in:
  - [src/web/src/pages/AddonLibraryPage.tsx](/home/turtle/chroma/src/web/src/pages/AddonLibraryPage.tsx)
- Runtime and maintenance events already exist through:
  - [src/server/instances/instanceRuntimeEventService.ts](/home/turtle/chroma/src/server/instances/instanceRuntimeEventService.ts)
- Internal backups currently capture BDS config and worlds through:
  - [src/server/instances/instanceBackupService.ts](/home/turtle/chroma/src/server/instances/instanceBackupService.ts)

Downloaded addon files are stored centrally under Chroma data storage. Instance rows currently register which downloaded addon files are available to an instance, while the intended longer-term product shape is a top-level Addon Library for discovery/download/update tracking plus an instance workspace tab for enable/disable state.

## Terms

- Addon: the Chroma-level record for something the user downloaded. The current implementation stores central files plus per-instance registrations; a future library model should make downloaded versions first-class records.
- Provider project: a project from an external provider such as CurseForge.
- Provider file: a specific downloadable file/release from a provider project.
- Pack: a Bedrock behavior pack or resource pack discovered inside an addon archive.
- Downloaded: Chroma has stored the provider file in `/var/lib/chroma/downloads/addons` and parsed its packs.
- Enabled: Chroma has imported the addon packs into BDS and referenced them from the active world's pack JSON files.
- Imported: copied from central Chroma addon storage into `bds/behavior_packs` or `bds/resource_packs`.

CurseForge API docs use "mods" broadly. Chroma should use "addons" in UI and shared types because the product is managing Bedrock addons, not Java Edition mods.

## Core Product Model

The product model should separate downloaded addons from instance enablement:

- Addon Library: the Chroma-level inventory for browsing, downloading, tracking updates, and retaining addon versions.
- Instance Addons: the per-instance enabled/disabled state for downloaded addons.

The current implementation stores downloaded files centrally, but still creates per-instance addon registration rows. The top-level Addon Library uses a target instance selector until a global addon-library database model is approved.

Central addon files are stored under:

- `/var/lib/chroma/downloads/addons`: production addon archive and extracted pack storage.
- `.runtime/var/lib/chroma/downloads/addons`: development addon archive and extracted pack storage.

Each instance has one addon-related generated runtime zone:

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
- leaves central downloaded addon storage intact

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

Central addon library layout:

```text
.runtime/var/lib/chroma/downloads/addons/
  curseforge/
    projects/
      <projectId>/
        files/
          <fileId>/
            archive/
              <original-file-name>
            extracted/
              ...
```

Instance generated runtime layout:

```text
<instancePath>/
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

Downloaded archives and extracted workspace files stay in central Chroma addon storage.

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
  - query params: `q`, `sort`, `page`, `pageSize`, `gameVersion`, `authorId`
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
- author names can filter results with provider-side `authorId` while showing a readable `author: Name` search value
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
   - archive appears under central Chroma addon storage
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

### Implementation Notes

- Replaced the early shared addon placeholder model with the roadmap-aligned model in:
  - [src/shared/types/addon.ts](/home/turtle/chroma/src/shared/types/addon.ts)
  - [src/shared/types/index.ts](/home/turtle/chroma/src/shared/types/index.ts)
  - [src/shared/types/web.ts](/home/turtle/chroma/src/shared/types/web.ts)
- Added SQLite tables and indexes for downloaded instance addons and discovered addon packs in:
  - [src/server/db/migrations.ts](/home/turtle/chroma/src/server/db/migrations.ts)
- Added read-only backend addon list/detail plumbing in:
  - [src/server/addons/addonRepository.ts](/home/turtle/chroma/src/server/addons/addonRepository.ts)
  - [src/server/addons/addonService.ts](/home/turtle/chroma/src/server/addons/addonService.ts)
  - [src/server/addons/addonRoutes.ts](/home/turtle/chroma/src/server/addons/addonRoutes.ts)
  - [src/server/instances/instanceRoutes.ts](/home/turtle/chroma/src/server/instances/instanceRoutes.ts)
- Added frontend API helpers and replaced the Addons placeholder with a read-only empty state/table in:
  - [src/web/src/api/chromaApi.ts](/home/turtle/chroma/src/web/src/api/chromaApi.ts)
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
  - [src/web/src/styles.css](/home/turtle/chroma/src/web/src/styles.css)
- CurseForge provider calls, downloads, archive extraction, and enable/disable behavior were intentionally left for later phases.

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Ran `pnpm build:web` successfully.
- Ran `./dev/dev-run.sh -build` successfully; the staged API and web UI started under `.runtime`.
- Manual browser smoke testing was not performed for this phase.

### Status

Completed on the current branch/worktree. Phase 1 is implemented as a read-only local addon model and UI shell.

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

### Implementation Notes

- Added shared provider status/search types in:
  - [src/shared/types/addon.ts](/home/turtle/chroma/src/shared/types/addon.ts)
  - [src/shared/types/web.ts](/home/turtle/chroma/src/shared/types/web.ts)
  - [src/shared/types/index.ts](/home/turtle/chroma/src/shared/types/index.ts)
- Added backend-only CurseForge API access in:
  - [src/server/addons/curseForgeClient.ts](/home/turtle/chroma/src/server/addons/curseForgeClient.ts)
  - [src/server/addons/curseForgeAddonProvider.ts](/home/turtle/chroma/src/server/addons/curseForgeAddonProvider.ts)
- Added instance-scoped provider routes in:
  - [src/server/addons/addonRoutes.ts](/home/turtle/chroma/src/server/addons/addonRoutes.ts)
  - `GET /api/instances/:instanceId/addons/providers/curseforge/status`
  - `GET /api/instances/:instanceId/addons/providers/curseforge/search`
- The provider service:
  - reads the CurseForge API key only on the backend from application settings
  - discovers the Minecraft Bedrock game and Addons class from CurseForge games/categories
  - caches resolved non-secret IDs in memory by API-key hint
  - maps Chroma sort labels to CurseForge sort fields
  - returns Chroma-shaped search results to the browser
- Extended the Instance workspace Addons tab in:
  - [src/web/src/api/chromaApi.ts](/home/turtle/chroma/src/web/src/api/chromaApi.ts)
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
  - [src/web/src/styles.css](/home/turtle/chroma/src/web/src/styles.css)
- Removed the top-level muted Addons item from:
  - [src/web/src/components/TopNav.tsx](/home/turtle/chroma/src/web/src/components/TopNav.tsx)
- Downloads remain disabled and are intentionally left for Phase 3.

### Validation Notes

- Verified current CurseForge API documentation for:
  - base URL `https://api.curseforge.com`
  - `x-api-key` authentication
  - page-size limits
  - games, categories, and mod search endpoints
  - search sort field enum values
- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Ran `pnpm build:web` successfully.
- Live CurseForge provider discovery was validated with a real API key stored in the local SQLite app settings.
- Live CurseForge search was validated with the Version filter blank:
  - provider resolved to `minecraft-bedrock` / `addons`
  - search returned results without exposing the API key to the browser
- Exact BDS patch versions such as `1.26.31.1` can return zero CurseForge results, so the Version filter now starts blank and shows an empty-results hint when needed.

### Status

Completed on the current branch/worktree. Phase 2 is implemented as provider status/search only; no addon files are downloaded yet.

## Phase 3: Download and Archive Inspection

### Objective

Download a selected CurseForge file into Chroma-managed addon storage and parse its Bedrock packs.

### Scope

- Add download route.
- Use CurseForge file download URL endpoint.
- Store original archive.
- Extract into Chroma-managed addon storage.
- Parse manifests.
- Insert `instance_addons` and `instance_addon_packs` rows.
- Show downloaded addons and pack summaries in UI.

### Validation Rules

- Valid `.mcpack`, `.mcaddon`, and `.zip` samples can be parsed.
- Unsupported or malformed archives become visible errors.
- Path traversal fixtures cannot write outside Chroma-managed addon storage.

### Implementation Notes

- Extended CurseForge API support in:
  - [src/server/addons/curseForgeClient.ts](/home/turtle/chroma/src/server/addons/curseForgeClient.ts)
  - Added mod detail, file detail, and file download URL calls.
- Added safe archive inspection in:
  - [src/server/addons/addonArchiveService.ts](/home/turtle/chroma/src/server/addons/addonArchiveService.ts)
- Archive inspection now:
  - rejects absolute paths and `..` traversal
  - rejects symlinks
  - extracts `.zip`, `.mcpack`, and `.mcaddon` zip-shaped archives
  - supports one level of nested `.mcpack` archives
  - parses Bedrock `manifest.json`
  - classifies packs as behavior, resource, or unsupported unknown
  - keeps bounded entry and extracted-size limits
- Added addon/packs write support in:
  - [src/server/addons/addonRepository.ts](/home/turtle/chroma/src/server/addons/addonRepository.ts)
  - [src/server/addons/addonService.ts](/home/turtle/chroma/src/server/addons/addonService.ts)
- Added the download route in:
  - [src/server/addons/addonRoutes.ts](/home/turtle/chroma/src/server/addons/addonRoutes.ts)
  - `POST /api/instances/:instanceId/addons/providers/curseforge/download`
- Added frontend download support in:
  - [src/shared/types/web.ts](/home/turtle/chroma/src/shared/types/web.ts)
  - [src/shared/types/index.ts](/home/turtle/chroma/src/shared/types/index.ts)
  - [src/web/src/api/chromaApi.ts](/home/turtle/chroma/src/web/src/api/chromaApi.ts)
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
- Downloaded addons remain inactive. Enable/disable behavior is intentionally left for Phase 4.

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Ran `pnpm build:web` successfully.
- Ran `git diff --check` successfully.
- Ran `./dev/dev-run.sh -build` successfully; the staged API and web UI started under `.runtime`.
- Live CurseForge download/inspection was initially validated with `Slugs Reloaded`:
  - original `.mcaddon` stored under the selected instance's addon workspace before central storage was added in Phase 4.6
  - archive extracted under the selected instance's addon workspace before central storage was added in Phase 4.6
  - one behavior pack and one resource pack were discovered from `manifest.json`
  - `instance_addons` and `instance_addon_packs` rows were created
- Initial validation showed a real Bedrock addon can exceed 2,000 ZIP entries, so the entry limit was raised to 10,000 while keeping an extracted-size cap.

### Status

Completed on the current branch/worktree. Phase 3 supports downloading and inspecting CurseForge addon files, but does not enable them in BDS yet.

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
- Disable leaves central downloaded addon storage intact.
- Running instances block addon changes.
- Internal backup exists before world JSON changes.

### Implementation Notes

- Added addon enablement backend logic in:
  - [src/server/addons/addonEnablementService.ts](/home/turtle/chroma/src/server/addons/addonEnablementService.ts)
- Added addon/pack status update support in:
  - [src/server/addons/addonRepository.ts](/home/turtle/chroma/src/server/addons/addonRepository.ts)
- Added enable/disable routes in:
  - [src/server/addons/addonRoutes.ts](/home/turtle/chroma/src/server/addons/addonRoutes.ts)
  - `POST /api/instances/:instanceId/addons/:addonId/enable`
  - `POST /api/instances/:instanceId/addons/:addonId/disable`
- Enable behavior:
  - requires the instance runtime to be stopped/inactive
  - resolves the active world from `activeWorldName`, a single world directory, or the default `Bedrock level`
  - creates an internal revert backup before world JSON changes
  - copies behavior/resource packs into Chroma-owned BDS pack folders
  - updates `world_behavior_packs.json` and `world_resource_packs.json`
  - marks addon and pack rows enabled
  - records an instance runtime event
- Disable behavior:
  - requires the instance runtime to be stopped/inactive
  - creates an internal revert backup before world JSON changes
  - removes matching world pack JSON entries
  - removes only recorded Chroma-owned imported pack folders
  - leaves central downloaded addon storage intact
  - marks addon and pack rows disabled
  - records an instance runtime event
- Added Instance Addons table actions in:
  - [src/web/src/api/chromaApi.ts](/home/turtle/chroma/src/web/src/api/chromaApi.ts)
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
  - [src/web/src/styles.css](/home/turtle/chroma/src/web/src/styles.css)

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Ran `pnpm build:web` successfully.
- Ran `git diff --check` successfully.
- Ran `./dev/dev-run.sh -build` successfully; the staged API and web UI started under `.runtime`.
- Live enable/disable was validated with the previously downloaded `Slugs Reloaded` addon:
  - enable changed addon status to `enabled`
  - one behavior pack and one resource pack were copied into BDS pack directories
  - world behavior/resource pack JSON files were updated
  - internal revert backups were created
  - disable changed addon status to `disabled`
  - world pack JSON files were emptied again
  - imported Chroma-owned pack folders were removed
  - downloaded addon files remained intact

### Status

Completed on the current branch/worktree. Phase 4 supports stopped-instance addon enable/disable; running-instance maintenance flow remains Phase 6.

## Phase 4.5: Addon Library Navigation

### Objective

Separate addon discovery/download from per-instance enablement in the Web UI.

### Scope

- Restore a top-level `Addon Library` navigation entry.
- Move CurseForge browse/download UI out of the Instance workspace.
- Keep the Instance workspace `Addons` tab focused on downloaded addons for that instance and enable/disable actions.
- Use the current per-instance addon registration model for now, with a target instance selector in the library download flow.
- Defer a true global addon-library data model and version retention policy to a later phase.

### Implementation Notes

- Added a top-level Addon Library page in:
  - [src/web/src/pages/AddonLibraryPage.tsx](/home/turtle/chroma/src/web/src/pages/AddonLibraryPage.tsx)
- Restored primary navigation for `Addon Library` in:
  - [src/web/src/components/TopNav.tsx](/home/turtle/chroma/src/web/src/components/TopNav.tsx)
  - [src/web/src/App.tsx](/home/turtle/chroma/src/web/src/App.tsx)
- Simplified the Instance workspace `Addons` tab in:
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
- Added Addon Library layout and control styling in:
  - [src/web/src/styles.css](/home/turtle/chroma/src/web/src/styles.css)

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build:web` successfully.
- Ran `git diff --check` successfully.

### Status

Completed on the current branch/worktree as a UI/product-structure step. Downloaded files are central, and Phase 4.7 completes central database registration.

## Phase 4.6: Central Addon Download Storage

### Objective

Move downloaded addon archives and extracted pack sources out of instance folders and into Chroma's central download storage.

### Scope

- Store CurseForge addon files under `/var/lib/chroma/downloads/addons`.
- Store development CurseForge addon files under `.runtime/var/lib/chroma/downloads/addons`.
- Keep per-instance BDS changes limited to copied `behavior_packs`, copied `resource_packs`, and world pack JSON references.
- Reuse an already downloaded provider file instead of downloading duplicate archives for each instance.
- Keep per-instance addon registration rows for enablement state, while central addon file records own provider metadata and downloaded file paths.

### Implementation Notes

- Added central addon storage path helpers in:
  - [src/server/addons/addonStoragePaths.ts](/home/turtle/chroma/src/server/addons/addonStoragePaths.ts)
- Updated CurseForge download storage in:
  - [src/server/addons/addonService.ts](/home/turtle/chroma/src/server/addons/addonService.ts)
- Updated enablement source-path validation in:
  - [src/server/addons/addonEnablementService.ts](/home/turtle/chroma/src/server/addons/addonEnablementService.ts)
- Removed new-instance creation of the old addon workspace directory in:
  - [src/server/instances/instanceFilesystem.ts](/home/turtle/chroma/src/server/instances/instanceFilesystem.ts)

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Ran `pnpm build:web` successfully.
- Ran `git diff --check` successfully.
- Ran `./dev/dev-run.sh -build` successfully; the staged API and web UI started under `.runtime`.
- Live CurseForge download/enable/disable was validated with `Modern Furniture | +750 BLOCKS`:
  - archive and extracted files were stored under `.runtime/var/lib/chroma/downloads/addons/curseforge/projects/829201/files/8296615`
  - downloaded addon paths did not point under `.runtime/var/lib/chroma/instances`
  - enable copied one pack into the selected instance's BDS pack folders
  - disable removed the copied `chroma_*` pack folder from the instance
  - central archive and extracted files remained after disable

### Status

Completed on the current branch/worktree. Downloaded addon files now live in central Chroma download storage; enable/disable copies only generated BDS pack state into the selected instance.

## Phase 4.7: Central Addon Library Database

### Objective

Make central addon library records the canonical database registration for downloaded provider files and discovered packs.

### Scope

- Add central `addon_files` records for provider file metadata and archive/extracted paths.
- Add central `addon_file_packs` records for discovered pack metadata and source paths.
- Keep `instance_addons` as per-instance registration and enablement state linked to `addon_files`.
- Keep `instance_addon_packs` as per-instance pack enablement state linked to `addon_file_packs`.
- Backfill existing instance-scoped addon rows into central library records without deleting existing runtime data.
- Add a central Addon Library list API for the Web UI.

### Implementation Notes

- Added central addon library tables, indexes, and backfill migration in:
  - [src/server/db/migrations.ts](/home/turtle/chroma/src/server/db/migrations.ts)
- Added central library item shared types in:
  - [src/shared/types/addon.ts](/home/turtle/chroma/src/shared/types/addon.ts)
  - [src/shared/types/web.ts](/home/turtle/chroma/src/shared/types/web.ts)
  - [src/shared/types/index.ts](/home/turtle/chroma/src/shared/types/index.ts)
- Updated addon repository reads and writes in:
  - [src/server/addons/addonRepository.ts](/home/turtle/chroma/src/server/addons/addonRepository.ts)
- Added central library listing service and route in:
  - [src/server/addons/addonService.ts](/home/turtle/chroma/src/server/addons/addonService.ts)
  - [src/server/addons/addonRoutes.ts](/home/turtle/chroma/src/server/addons/addonRoutes.ts)
  - `GET /api/addons/library`
- Added central CurseForge provider routes in:
  - [src/server/addons/addonRoutes.ts](/home/turtle/chroma/src/server/addons/addonRoutes.ts)
  - `GET /api/addons/providers/curseforge/status`
  - `GET /api/addons/providers/curseforge/search`
  - `POST /api/addons/providers/curseforge/download`
- Updated the Addon Library Web UI to list central addon file records in:
  - [src/web/src/api/chromaApi.ts](/home/turtle/chroma/src/web/src/api/chromaApi.ts)
  - [src/web/src/pages/AddonLibraryPage.tsx](/home/turtle/chroma/src/web/src/pages/AddonLibraryPage.tsx)

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Ran `pnpm build:web` successfully.
- Ran `./dev/dev-run.sh -build` successfully; migration/backfill completed on the existing `.runtime` SQLite database.
- Verified the migrated database had:
  - central `addon_files` rows
  - central `addon_file_packs` rows
  - zero `instance_addons` rows missing `addon_file_id`
  - zero `instance_addon_packs` rows missing `addon_file_pack_id`
- Live CurseForge download/enable/disable was validated with `GSG's New Ores`:
  - a new central `addon_files` row was created
  - new instance registration linked to the central addon file through `addon_file_id`
  - two instance pack rows linked to central pack rows through `addon_file_pack_id`
  - central Addon Library service returned the new library item
  - enable copied two packs into the selected instance's BDS pack folders
  - disable removed the copied `chroma_*` pack folders
  - central archive and extracted files remained after disable
- Live central-only library download was validated with `Realms & Races | A D&D Inspired addon`:
  - central `addon_files` row was created
  - archive and extracted paths were under `.runtime/var/lib/chroma/downloads/addons`
  - `registeredInstanceCount` was `0`
  - `instance_addons` row count did not change

### Status

Completed on the current branch/worktree. Addon files and discovered packs are now centrally registered; instance rows represent registration and enablement state. The Addon Library browse/download UI no longer targets an instance.

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
