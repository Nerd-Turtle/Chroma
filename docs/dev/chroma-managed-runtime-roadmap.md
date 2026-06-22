# Chroma-Managed Runtime Roadmap

## Overall Objective

Evolve Chroma's current in-process BDS runtime management into a reliable Chroma-managed server platform that can:

- start, stop, restart, and update BDS instances safely
- detect and prevent obvious runtime conflicts before a server is started
- verify that a started server is actually healthy instead of assuming success from `spawn()`
- provide live operational visibility for each instance
- provide a Chroma-hosted BDS console experience
- preserve instance isolation across runtime, logs, settings, backups, and maintenance workflows

When all phases in this roadmap are complete, Chroma should be the trusted control plane for BDS instance lifecycle and runtime observability without depending on `systemd` for per-instance supervision.

## Current Baseline

Current runtime behavior is centered around:

- [src/server/bds/bdsProcessManager.ts](/home/turtle/chroma/src/server/bds/bdsProcessManager.ts)
- [src/server/bds/bdsRuntimeService.ts](/home/turtle/chroma/src/server/bds/bdsRuntimeService.ts)
- [src/server/bds/bdsRoutes.ts](/home/turtle/chroma/src/server/bds/bdsRoutes.ts)
- [src/server/instances/instanceService.ts](/home/turtle/chroma/src/server/instances/instanceService.ts)
- [src/server/instances/serverPropertiesEditorService.ts](/home/turtle/chroma/src/server/instances/serverPropertiesEditorService.ts)

Today Chroma:

- spawns BDS as a child process
- stores runtime state in memory
- tracks simple status, PID, timestamps, exit code, and messages
- writes stdout/stderr to `bds-current.log`
- exposes runtime controls over API

Known gaps visible in the current implementation:

- no preflight port conflict detection
- no post-start health verification beyond the child process existing
- no reconciliation after Chroma restarts
- no first-class runtime state for maintenance operations
- no live console session in the WebUI
- no structured runtime event history for troubleshooting

## Phase Tracking Convention

As each phase is implemented, append the following under that phase:

- `Implementation Notes`
- `Validation Notes`
- `Status`

This keeps the roadmap useful both as a plan and as a running delivery record.

## Phase 1: Runtime State Model Hardening

### Objective

Make Chroma's runtime model richer and explicit enough to support validation, maintenance, and console workflows without overloading the current `running/stopped/error` states.

### Scope

- Review and extend shared runtime and instance status types in:
  - [src/shared/types/bdsRuntime.ts](/home/turtle/chroma/src/shared/types/bdsRuntime.ts)
  - [src/shared/types/instance.ts](/home/turtle/chroma/src/shared/types/instance.ts)
- Separate:
  - desired state
  - observed process state
  - health state
  - maintenance state
- Decide which states belong in:
  - runtime memory only
  - SQLite persistence
  - both
- Add explicit states/messages for scenarios such as:
  - starting
  - start validation pending
  - port conflict
  - crashed on start
  - updating
  - backing up
  - restore in progress
  - degraded
- Define a consistent runtime event payload shape for future audit/history logging.

### Validation Rules

- Shared types can represent every currently known lifecycle condition without inventing ad hoc strings in route handlers.
- Backend runtime operations can return structured results for success, warning, and failure conditions.
- The UI can distinguish process started vs healthy vs maintenance in a deterministic way.

### Implementation Notes

- Extended the shared runtime model in:
  - [src/shared/types/bdsRuntime.ts](/home/turtle/chroma/src/shared/types/bdsRuntime.ts)
  - [src/shared/types/index.ts](/home/turtle/chroma/src/shared/types/index.ts)
- Added explicit runtime fields for:
  - `desiredStatus`
  - `healthStatus`
  - `maintenanceStatus`
  - `observedAt`
  - `isProcessActive`
- Extended instance status values in:
  - [src/shared/types/instance.ts](/home/turtle/chroma/src/shared/types/instance.ts)
  - Added support for `unknown`, `degraded`, `updating`, `backing_up`, and `restoring`.
- Updated [src/server/bds/bdsProcessManager.ts](/home/turtle/chroma/src/server/bds/bdsProcessManager.ts) so runtime transitions consistently populate the richer state model.
- Updated [src/server/bds/bdsRuntimeService.ts](/home/turtle/chroma/src/server/bds/bdsRuntimeService.ts) so:
  - instance status mapping is derived from runtime state
  - instances marked active in SQLite but missing in-memory runtime state are surfaced as `unknown`
- Updated runtime-sensitive backend flows:
  - [src/server/instances/serverPropertiesEditorService.ts](/home/turtle/chroma/src/server/instances/serverPropertiesEditorService.ts)
  - [src/server/instances/instanceAutoUpdateService.ts](/home/turtle/chroma/src/server/instances/instanceAutoUpdateService.ts)
- Updated the Instances workspace in:
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
  - [src/web/src/styles.css](/home/turtle/chroma/src/web/src/styles.css)
- The UI now distinguishes:
  - desired state
  - process state
  - health
  - maintenance
  - last observed time
  - runtime note/message

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Confirmed the shared types compile cleanly through backend and frontend call sites.
- Confirmed the Instances page can consume the richer runtime payload shape at build time.
- Manual browser smoke testing was not performed for this phase.

### Status

Completed on the current branch/worktree. Phase 1 is implemented, but `healthStatus` remains intentionally conservative until Phase 3 adds true post-start verification.

## Phase 2: Pre-Start Validation and Conflict Detection

### Objective

Prevent clearly invalid or conflicting starts before BDS is spawned by running a reusable series of pre-start validation checks.

### Scope

- Add a reusable pre-start validation layer before `startBdsForInstance(...)`.
- Design the validation model so Chroma can execute multiple checks, collect warnings and blocking errors, and decide whether start is allowed.
- Validate at minimum:
  - BDS is installed
  - required files exist
  - `server.properties` can be loaded
  - configured IPv4 and IPv6 ports are parseable
  - another Chroma-managed instance is not already configured to use the same active ports in a conflicting way
  - the host OS does not already have the target ports bound by another program
- Keep the validation pipeline open for future conflict checks beyond ports.
- Distinguish:
  - blocking errors that prevent start
  - warnings that allow start but should be surfaced to the operator
- Surface validation failures back through the API in a structured way.
- Update the Instances workspace so a failed start can clearly explain why it was blocked.

### Validation Rules

- Starting two instances with the same active port combination is blocked before process launch.
- If an external process already owns the configured BDS port, Chroma reports that clearly and does not mark the instance as running.
- Manual testing can demonstrate:
  - valid start succeeds
  - duplicate port start is blocked
  - externally occupied port start is blocked

### Implementation Notes

- Added a reusable pre-start validation pipeline in:
  - [src/server/bds/bdsStartValidationService.ts](/home/turtle/chroma/src/server/bds/bdsStartValidationService.ts)
- The validator pipeline now supports multiple checks and returns:
  - blocking `errors`
  - non-blocking `warnings`
  - `canStart`
- Implemented Phase 2 checks for:
  - BDS install presence
  - BDS executable presence/readability
  - instance settings presence
  - `server.properties` presence/readability
  - configured port range/integer validation
  - config-level port overlap with other Chroma-managed instances
  - host UDP port availability for configured IPv4 and IPv6 ports
- Config-level overlaps are severity-aware:
  - `error` if another instance appears active (`running`, `starting`, `unknown`)
  - `warning` if another configured instance shares the port but is not currently active
- Updated [src/server/bds/bdsRuntimeService.ts](/home/turtle/chroma/src/server/bds/bdsRuntimeService.ts) so `startBdsForInstance(...)` must pass the Phase 2 validator pipeline before spawning BDS.
- Updated [src/server/bds/bdsRoutes.ts](/home/turtle/chroma/src/server/bds/bdsRoutes.ts) so blocked starts return `409` with structured validation payloads instead of a generic `400`.
- Added shared response shapes in:
  - [src/shared/types/web.ts](/home/turtle/chroma/src/shared/types/web.ts)
  - [src/shared/types/index.ts](/home/turtle/chroma/src/shared/types/index.ts)
- Updated [src/web/src/api/chromaApi.ts](/home/turtle/chroma/src/web/src/api/chromaApi.ts) so frontend callers receive combined operator-facing error messages when validation blocks a start.

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Confirmed the new validator service compiles cleanly through backend and frontend call sites.
- Confirmed blocked-start responses are now represented as structured API payloads at the shared type layer.
- Manual runtime smoke testing for actual port conflicts was not performed in this phase.

### Status

Completed on the current branch/worktree. Phase 2 is implemented, with the main remaining gap being richer UI treatment of warnings beyond the current operator-facing blocked-start message.

## Phase 3: Post-Start Verification and Crash Detection

### Objective

Stop treating `spawn()` success as proof that the server is healthy.

### Scope

- Add a post-start verification workflow after `BdsProcessManager.start(...)`.
- Define what “healthy start” means for BDS. Candidate signals:
  - process still alive after a minimum interval
  - expected log output detected
  - optional socket reachability check
- Add a bounded startup window that can classify:
  - healthy running
  - exited immediately
  - hung/unknown start
  - startup error
- Persist useful failure context:
  - exit code
  - signal
  - recent log tail
  - validation failure reason
- Ensure status transitions in the database reflect final verified state.

### Validation Rules

- A BDS process that exits shortly after launch is not shown as successfully running.
- The UI can show the difference between:
  - start requested
  - start in progress
  - start verified
  - start failed
- Manual testing can intentionally trigger a failed start and confirm Chroma records the correct final state.

### Implementation Notes

- Updated [src/server/bds/bdsProcessManager.ts](/home/turtle/chroma/src/server/bds/bdsProcessManager.ts) to add a bounded startup verification window.
- Startup now transitions through:
  - `starting` + `pending`
  - `running` + `healthy` when the process survives the verification window and produces runtime output
  - `running` + `degraded` when the process survives the verification window without recent startup output
  - `error` / `stopped` when the process exits during or before startup verification
- Added recent runtime evidence capture:
  - `recentLogTail` is now stored on `BdsRuntimeState`
  - the process manager maintains a bounded tail of recent output lines per instance
- Updated failure/runtime messages so startup outcomes retain more actionable context.
- Added [src/server/bds/bdsRuntimeService.ts](/home/turtle/chroma/src/server/bds/bdsRuntimeService.ts) logic to:
  - set instance status to `starting` before startup verification begins
  - treat failed startup verification as a failed start instead of a successful runtime response
- Added `BdsStartupVerificationError` handling in [src/server/bds/bdsRoutes.ts](/home/turtle/chroma/src/server/bds/bdsRoutes.ts) so startup verification failures return structured runtime context.
- Updated runtime display in:
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
  - [src/web/src/styles.css](/home/turtle/chroma/src/web/src/styles.css)
- The Instances workspace now surfaces:
  - clearer `Start In Progress` process state
  - richer runtime note messaging
  - recent output tail for startup evidence/failure context

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Confirmed the updated runtime model compiles cleanly through backend and frontend call sites.
- Confirmed the shared runtime type now carries recent startup/runtime evidence.
- Manual runtime smoke testing for actual early-exit startup failures was not performed in this phase.

### Status

Completed on the current branch/worktree. Phase 3 is implemented with a bounded startup verification model, though health verification is still intentionally lightweight and currently relies on process survival plus recent runtime output rather than deeper protocol-level or socket-level proof.

## Phase 4: Runtime Reconciliation and Recovery

### Objective

Handle Chroma restarts and process desynchronization safely.

### Scope

- Define what should happen when Chroma restarts while one or more BDS processes were previously launched.
- Assume Chroma may need to rediscover surviving child processes if shutdown was not clean.
- Decide how rediscovered survivors should be handled:
  - reattach and continue monitoring
  - reattach only long enough to perform a clean stop
  - mark runtime unknown and require operator action
- Add a runtime reconciliation pass during application startup.
- Introduce explicit handling for:
  - PID exists but does not belong to expected process
  - DB says running but no process exists
  - process exists but runtime memory is empty
- Document expectations for development runtime vs future production behavior.

### Validation Rules

- Restarting Chroma does not silently report stale runtime state as healthy.
- Reconciliation behavior is deterministic and documented.
- A manual restart of the Chroma app produces predictable runtime states for previously running instances.

### Implementation Notes

- Added persisted runtime handle support in:
  - [src/server/bds/bdsRuntimeHandleService.ts](/home/turtle/chroma/src/server/bds/bdsRuntimeHandleService.ts)
- Each managed runtime now persists a per-instance runtime handle file under the instance `csm` directory, including:
  - instance ID
  - PID
  - started time
  - observed time
- Updated [src/server/bds/bdsProcessManager.ts](/home/turtle/chroma/src/server/bds/bdsProcessManager.ts) to:
  - persist runtime handles on successful process spawn
  - remove runtime handles on clean or failed process exit
  - keep an instance map for later reconciliation and recovered-stop flows
  - reconcile persisted runtime handles back into in-memory runtime state
  - resume monitoring rediscovered processes as active runtime state after Chroma restart
  - mark rediscovered processes as `running` + `degraded` with a clear note that live command streaming requires a fresh managed restart
  - support stopping rediscovered processes even without a live child-process stdin channel by signaling the recovered PID directly
- Updated [src/server/bds/bdsRuntimeService.ts](/home/turtle/chroma/src/server/bds/bdsRuntimeService.ts) to add `reconcileBdsRuntimeStates(...)`.
- Updated [src/server/index.ts](/home/turtle/chroma/src/server/index.ts) so reconciliation runs during server startup before Fastify begins serving requests.
- Reconciliation now handles:
  - persisted handle exists and process matches expected instance working directory
  - persisted handle exists but process is gone
  - persisted handle exists but PID no longer matches the expected instance working directory
  - instance was previously marked active but no persisted handle exists
- Reconciled runtime state is written back into the instance status model so the UI and dashboard do not continue to rely on stale pre-restart assumptions.

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Confirmed the startup reconciliation path compiles cleanly through the application boot sequence.
- Confirmed the runtime model and process manager now support rediscovered active processes without requiring an in-memory child-process handle.
- Performed manual `.runtime` restart/recovery validation on June 19, 2026:
  - rebuilt and restaged the current branch with `./dev/dev-run.sh -build`
  - normalized two legacy instances from `unknown` to `stopped` through the authenticated API because they had been started before runtime handle persistence existed
  - started `inst_44c2014e26` through `POST /api/instances/:instanceId/bds/start`
  - confirmed a persisted runtime handle was written to `instances/<instanceId>/csm/runtime-process.json`
  - force-killed the Chroma API process with `kill -9` while leaving the BDS child process alive
  - restarted Chroma with `./dev/dev-run.sh -start`
  - confirmed reconciliation logged the instance as `running` with `healthStatus=degraded` and the recovered PID
  - confirmed `GET /api/instances/:instanceId/bds/runtime` returned the expected recovered-process warning message
  - confirmed `POST /api/instances/:instanceId/bds/stop` successfully stopped the rediscovered process, removed the runtime handle, and returned the instance to `stopped`
- No Phase 4 code corrections were required after manual validation.
- Observed limitation:
  - instances that were last started before runtime handle persistence existed reconcile to `unknown` on the next Chroma restart because there is no persisted ownership record to trust; once they are started under the Phase 4 runtime model, subsequent reconciliation behaves as designed.

### Status

Completed on the current branch/worktree and manually validated in `.runtime`. Phase 4 is implemented with PID-based runtime handle reconciliation and recovered-process monitoring, though recovered processes remain intentionally degraded because Chroma cannot regain a live stdin/stdout control channel without a fresh managed restart.

## Phase 5: Runtime Event Log and Operational History

### Objective

Create a Chroma-native event trail for runtime actions and failures.

### Scope

- Add an event log model for instance runtime activity such as:
  - start requested
  - start blocked by validation
  - process started
  - startup verified
  - process stopped
  - process crashed
  - backup created
  - update check performed
  - update started/completed/failed
- Store the primary event trail per instance so operational history remains scoped to the instance it belongs to.
- Decide whether SQLite should also hold summary/index metadata for filtering and future dashboard views.
- Add backend helpers for appending and querying recent events.
- Surface recent operational events in the Instances workspace.

### Validation Rules

- Each major runtime action records an event with timestamp and result.
- Failures can be reviewed after the fact without reading raw BDS log output.
- The UI can display a recent activity list for the selected instance.

### Implementation Notes

- Added shared runtime event types in:
  - [src/shared/types/runtimeEvent.ts](/home/turtle/chroma/src/shared/types/runtimeEvent.ts)
  - [src/shared/types/web.ts](/home/turtle/chroma/src/shared/types/web.ts)
  - [src/shared/types/index.ts](/home/turtle/chroma/src/shared/types/index.ts)
- Added SQLite indexing for per-instance activity in:
  - [src/server/db/migrations.ts](/home/turtle/chroma/src/server/db/migrations.ts)
  - `instance_runtime_events` stores the queryable event summary/index
- Added file-first event persistence in:
  - [src/server/instances/instanceRuntimeEventService.ts](/home/turtle/chroma/src/server/instances/instanceRuntimeEventService.ts)
  - events are appended to `csm/events/runtime-events.jsonl` inside each instance
- Updated instance directory provisioning in:
  - [src/server/instances/instanceFilesystem.ts](/home/turtle/chroma/src/server/instances/instanceFilesystem.ts)
  - new instances now create `csm/events`
- Added an authenticated events endpoint in:
  - [src/server/instances/instanceRoutes.ts](/home/turtle/chroma/src/server/instances/instanceRoutes.ts)
  - `GET /api/instances/:instanceId/events`
- Added event recording for:
  - runtime lifecycle actions in [src/server/bds/bdsRuntimeService.ts](/home/turtle/chroma/src/server/bds/bdsRuntimeService.ts)
  - backup creation in [src/server/instances/instanceBackupService.ts](/home/turtle/chroma/src/server/instances/instanceBackupService.ts)
  - update checks / updates in [src/server/instances/instanceAutoUpdateService.ts](/home/turtle/chroma/src/server/instances/instanceAutoUpdateService.ts)
  - instance overview edits and creation in [src/server/instances/instanceService.ts](/home/turtle/chroma/src/server/instances/instanceService.ts)
  - `server.properties` saves in [src/server/instances/serverPropertiesEditorService.ts](/home/turtle/chroma/src/server/instances/serverPropertiesEditorService.ts)
- Updated the Instances workspace in:
  - [src/web/src/api/chromaApi.ts](/home/turtle/chroma/src/web/src/api/chromaApi.ts)
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
  - [src/web/src/styles.css](/home/turtle/chroma/src/web/src/styles.css)
- The Overview tab now shows a recent activity section with severity, action, timestamp, and message for the selected instance.

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Rebuilt the staged `.runtime` app with `./dev/dev-run.sh -build`.
- Performed manual `.runtime` smoke testing on June 19, 2026 against `inst_44c2014e26`:
  - started the instance through the authenticated API
  - created an export backup
  - saved `server.properties`
  - stopped the instance
  - queried `GET /api/instances/:instanceId/events`
  - tailed `csm/events/runtime-events.jsonl`
- Confirmed Phase 5 records and surfaces:
  - `start_requested`
  - `start_verified`
  - `backup_created`
  - `server_properties_saved`
  - `stop_requested`
  - `stop_completed`
  - reconciliation warnings when an instance was previously active but had no persisted runtime handle
- Manual validation discovered an existing stop-path bug in [src/server/bds/bdsProcessManager.ts](/home/turtle/chroma/src/server/bds/bdsProcessManager.ts):
  - `Cannot access 'stopPromise' before initialization`
  - fixed during this phase by moving timer cleanup into the stop promise executor without self-referencing the promise before initialization
- After the fix, stop completed successfully and produced the expected runtime event trail.

### Status

Completed on the current branch/worktree and manually validated in `.runtime`. Phase 5 now provides a file-first per-instance runtime event trail with SQLite query support and a recent activity view in the Instances workspace.

## Phase 6: Live Console Transport

### Objective

Add a Chroma-hosted shared console experience for BDS instances.

### Scope

- Design a dedicated console transport between:
  - BDS child process stdin/stdout/stderr
  - Fastify backend
  - authenticated WebUI session
- Decide transport style:
  - WebSocket
  - SSE plus command POST
  - another lightweight approach
- Add output buffering and a bounded scrollback strategy.
- Support:
  - sending commands to the running instance
  - receiving live output
  - reconnecting without losing all recent output
- Support a shared writer model for each instance console:
  - multiple authenticated admins can connect to the same instance console at the same time
  - all connected admins receive the same live output stream
  - any connected admin can submit commands into the shared instance console
- Support one admin attaching to multiple different BDS instance consoles at once.
- Enforce access control so only authenticated authorized users can attach.
- Define behavior when:
  - instance is stopped
  - instance restarts mid-session
  - multiple browser sessions attach at once

### Validation Rules

- A running BDS instance can be controlled with commands from the WebUI.
- Live output is visible in near real time.
- Disconnecting and reconnecting preserves recent console context according to the chosen scrollback policy.
- Stopped instances do not accept console commands and surface a clear message instead.
- Two connected admins can watch the same instance console and both submit commands into the same shared live console stream.

### Implementation Notes

- Chose a lightweight transport model for Phase 6:
  - Server-Sent Events for live console output/status streaming
  - authenticated HTTP `POST` for command submission
- Added shared console types in:
  - [src/shared/types/bdsConsole.ts](/home/turtle/chroma/src/shared/types/bdsConsole.ts)
  - [src/shared/types/web.ts](/home/turtle/chroma/src/shared/types/web.ts)
  - [src/shared/types/index.ts](/home/turtle/chroma/src/shared/types/index.ts)
- Extended [src/server/bds/bdsProcessManager.ts](/home/turtle/chroma/src/server/bds/bdsProcessManager.ts) with:
  - bounded per-instance console scrollback buffering
  - live listener subscription support
  - console line capture for:
    - `stdout`
    - `stderr`
    - submitted commands
    - system/runtime lifecycle messages
  - per-instance console snapshots containing:
    - buffered lines
    - runtime state
    - `liveOutput`
    - `canWrite`
- Added runtime-service wrappers in:
  - [src/server/bds/bdsRuntimeService.ts](/home/turtle/chroma/src/server/bds/bdsRuntimeService.ts)
  - these expose console snapshot retrieval, subscription, and guarded command submission
- Added authenticated console routes in:
  - [src/server/bds/bdsRoutes.ts](/home/turtle/chroma/src/server/bds/bdsRoutes.ts)
  - `GET /api/instances/:instanceId/bds/console/stream`
  - `POST /api/instances/:instanceId/bds/console/commands`
- Console command submission is explicitly blocked when:
  - the instance is stopped
  - the instance is not in a writable live-managed runtime state
  - Chroma has only recovered the process in a degraded no-stdin/no-stdout state
- Added frontend console support in:
  - [src/web/src/api/chromaApi.ts](/home/turtle/chroma/src/web/src/api/chromaApi.ts)
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
  - [src/web/src/styles.css](/home/turtle/chroma/src/web/src/styles.css)
- The Instances workspace now includes a console icon in the control bar that opens a right-side console drawer with:
  - live shared output
  - command entry
  - connection/read-only state indicators
  - preserved scrollback for reconnects within the running Chroma process

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Rebuilt the staged `.runtime` app with `./dev/dev-run.sh -build`.
- Performed manual `.runtime` console validation on June 19, 2026:
  - confirmed `POST /api/instances/:instanceId/bds/console/commands` is blocked with a clear message while the instance is stopped
  - started `inst_44c2014e26`
  - opened two separate authenticated SSE listeners against the same instance console stream
  - submitted `list` through the console command endpoint
  - confirmed both listeners received:
    - the shared `command` line
    - the shared BDS response line `There are 0/10 players online:`
  - stopped the instance and confirmed the stream updated to a non-writable stopped state with final stop output
- Manual validation confirmed:
  - shared-writer behavior for the same instance
  - reconnect-friendly snapshot delivery
  - clear stopped/read-only console behavior
  - near-real-time live output over SSE
- No additional Phase 6 code corrections were required after the final manual validation pass.

### Status

Completed on the current branch/worktree and manually validated in `.runtime`. Phase 6 now provides a Chroma-hosted shared console transport with SSE output streaming, authenticated command submission, bounded scrollback, and a WebUI console drawer.

## Phase 7: Log Pipeline and Viewer Improvements

### Objective

Turn the current raw `bds-current.log` output into a usable Chroma log experience while keeping historical logs separate from the live console experience.

### Scope

- Review how stdout/stderr is appended today in [src/server/bds/bdsProcessManager.ts](/home/turtle/chroma/src/server/bds/bdsProcessManager.ts).
- Decide how to handle:
  - current log
  - rotated historical logs
  - log size limits
  - log tail retrieval
- Add backend endpoints for:
  - latest log tail
  - paged log retrieval
  - log download if desired later
- Add an instance log viewer in the UI.
- Ensure console and file logging can coexist without double-processing confusion.
- Keep clear separation between:
  - live console interaction
  - Chroma management events
  - BDS/runtime output and historical logs

### Validation Rules

- BDS output remains available after the console is closed.
- Log files do not grow forever without rotation or retention handling.
- The UI can display recent log lines for a selected instance without needing shell access.

### Implementation Notes

- Added a dedicated raw BDS log service in:
  - [src/server/bds/bdsLogService.ts](/home/turtle/chroma/src/server/bds/bdsLogService.ts)
- The log service now owns:
  - current log file handling
  - historical log rotation naming
  - historical retention pruning
  - current-tail retrieval
  - paged log retrieval
  - log filename validation to prevent path traversal
- Updated [src/server/bds/bdsProcessManager.ts](/home/turtle/chroma/src/server/bds/bdsProcessManager.ts) so raw stdout/stderr append through the dedicated log service instead of directly appending to `bds-current.log`.
- Added log lifecycle behavior:
  - rotate a non-empty `bds-current.log` when a new BDS start begins
  - rotate the current log again if it grows beyond the configured size cap
  - retain only the most recent historical log files
- Added shared log response types in:
  - [src/shared/types/web.ts](/home/turtle/chroma/src/shared/types/web.ts)
  - [src/shared/types/index.ts](/home/turtle/chroma/src/shared/types/index.ts)
- Added authenticated log endpoints in:
  - [src/server/bds/bdsRoutes.ts](/home/turtle/chroma/src/server/bds/bdsRoutes.ts)
  - `GET /api/instances/:instanceId/bds/logs`
  - `GET /api/instances/:instanceId/bds/logs/current/tail`
  - `GET /api/instances/:instanceId/bds/logs/:fileName`
- Added runtime-service wrappers in:
  - [src/server/bds/bdsRuntimeService.ts](/home/turtle/chroma/src/server/bds/bdsRuntimeService.ts)
- Added WebUI log viewer support in:
  - [src/web/src/api/chromaApi.ts](/home/turtle/chroma/src/web/src/api/chromaApi.ts)
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
  - [src/web/src/styles.css](/home/turtle/chroma/src/web/src/styles.css)
- The Instances workspace now includes a dedicated `Logs` tab that:
  - defaults to the current raw log tail
  - lists current and rotated historical log files separately from the live console
  - supports paging through archived raw log files

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Rebuilt the staged `.runtime` app with `./dev/dev-run.sh -build`.
- Performed manual `.runtime` Phase 7 validation on June 19, 2026 using `inst_44c2014e26`:
  - started the instance
  - sent `list` through the console to generate additional raw BDS output
  - stopped the instance
  - started and stopped the instance again to force a start-time rotation of the previous `bds-current.log`
  - queried `GET /api/instances/:instanceId/bds/logs`
  - queried `GET /api/instances/:instanceId/bds/logs/current/tail`
  - queried `GET /api/instances/:instanceId/bds/logs/:fileName` against a rotated archive
- Manual validation confirmed:
  - raw BDS output persisted independently of the live console session
  - rotated historical logs were created and listed
  - the current-tail endpoint returned recent raw BDS lines from the current file
  - paged retrieval worked against a historical archive
  - raw BDS logs remained separate from both Phase 5 runtime events and Phase 6 live console transport
- No additional Phase 7 code corrections were required after manual validation.

### Status

Completed on the current branch/worktree and manually validated in `.runtime`. Phase 7 now provides rotated raw BDS log handling, retention limits, current-tail and paged log APIs, and a dedicated log viewer in the Instances workspace.

## Phase 8: Maintenance-Oriented Runtime Operations

### Objective

Make backup, update, restore, and settings-edit workflows runtime-aware and safe.

### Scope

- Review maintenance flows currently touching runtime:
  - internal backup
  - export backup
  - automatic update
  - manual update
  - `server.properties` editing
- Standardize maintenance sequencing:
  - warn users
  - notify players if server is running
  - stop server
  - back up required files
  - perform action
  - restore required files
  - restart if appropriate
- Expand runtime state/messages during maintenance so the UI reflects what is happening.
- Ensure maintenance failures do not leave runtime state ambiguous.

### Validation Rules

- Update and backup flows visibly move through maintenance states in the UI.
- Failed maintenance leaves enough state and logging to troubleshoot what happened.
- Config edits that require restart clearly communicate that requirement.

### Implementation Notes

- Added explicit maintenance-state mutation support in:
  - [src/server/bds/bdsProcessManager.ts](/home/turtle/chroma/src/server/bds/bdsProcessManager.ts)
  - [src/server/bds/bdsRuntimeService.ts](/home/turtle/chroma/src/server/bds/bdsRuntimeService.ts)
- Chroma can now push runtime state through maintenance phases without fabricating a fake process transition, while still updating the instance status record from the runtime model.
- Updated [src/server/instances/instanceAutoUpdateService.ts](/home/turtle/chroma/src/server/instances/instanceAutoUpdateService.ts) so update orchestration now moves through explicit maintenance stages:
  - `update` while preparing and installing
  - `backup` while creating the internal revert backup
  - `restore` while restoring config and bringing the instance back
- Manual and automatic updates now:
  - warn connected players before shutdown when the instance is running
  - stop the instance before installation
  - create an internal revert backup
  - restore config files after installation
  - restart the instance only if it was running beforehand
  - clear maintenance back to `idle` on success or failure
- Added a managed export-backup wrapper in:
  - [src/server/instances/instanceBackupService.ts](/home/turtle/chroma/src/server/instances/instanceBackupService.ts)
- Export backups are now runtime-aware:
  - if the instance is running, Chroma warns players, stops the instance, creates the zip, and restarts the instance afterward
  - if the instance is already stopped, Chroma still surfaces explicit backup maintenance state and completion messaging
- Updated [src/server/instances/instanceRoutes.ts](/home/turtle/chroma/src/server/instances/instanceRoutes.ts) so the export-backup API uses the managed maintenance-aware workflow.
- Updated [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx) so the selected instance view refreshes while backup/update actions are in flight, allowing maintenance state transitions to appear in the UI during the long-running operation instead of only after the request completes.
- `server.properties` editing remains a direct file save in this phase, but the existing restart-required messaging remains the explicit operator signal for config changes that need a restart.

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Rebuilt the staged `.runtime` app with `./dev/dev-run.sh -build`.
- Performed manual `.runtime` Phase 8 validation on June 19, 2026 against `inst_44c2014e26`:
  - started the instance and confirmed it reached `running` + `healthy`
  - triggered `POST /api/instances/:instanceId/backups/export` while the instance was running
  - polled `GET /api/instances/:instanceId/bds/runtime` during the export backup and confirmed:
    - `maintenanceStatus=backup` while the instance was being prepared and stopped
    - the instance transitioned through `stopping`
    - the instance restarted automatically after the export backup completed
  - confirmed the export backup API returned a downloadable zip record and the event trail recorded `backup_created`
  - forced the recorded instance version back to `1.26.30.5` in the disposable `.runtime` SQLite database so the manual update path had a real newer version to install
  - triggered `POST /api/instances/:instanceId/bds/update` while the instance was running
  - polled `GET /api/instances/:instanceId/bds/runtime` during the update and confirmed:
    - `maintenanceStatus=update` while the instance was being prepared for maintenance
    - the instance stopped before install
    - the runtime message advanced to `Installing BDS 1.26.31.1.`
    - the instance restarted automatically after install/restore and returned to `running` + `healthy`
  - confirmed the event trail recorded:
    - `update_check_completed`
    - `update_started`
    - `backup_created` for the internal revert backup
    - `update_completed`
  - confirmed the instance record returned `bdsVersion=1.26.31.1` after the update completed
  - queried `GET /api/instances/:instanceId/server-properties` and `PUT /api/instances/:instanceId/server-properties` while the instance was running and confirmed `restartRequired=true` is still surfaced for file edits that need a restart
- Manual validation note:
  - the `restore` maintenance phase exists in the orchestration code, but in the staged manual run it completed quickly enough that polling observed the surrounding `update` and restart transitions more clearly than a long-lived visible `restore` state.

### Status

Completed on the current branch/worktree and manually validated in `.runtime`. Phase 8 now treats export backups and BDS updates as runtime-aware maintenance workflows with explicit maintenance state transitions, player warning/stop/restart sequencing, and preserved restart-required messaging for `server.properties` edits.

## Phase 9: Instance Workspace Runtime UX

### Objective

Make runtime health, conflicts, console access, and troubleshooting understandable from the Instances workspace.

### Scope

- Extend the Instances list and detail panes to show:
  - runtime state
  - health/verification state
  - port conflict warnings
  - recent operational events
  - console access entry point
  - log access entry point
- Add clear user-facing language for:
  - blocked starts
  - maintenance in progress
  - update available vs update failed
  - runtime degraded vs fully running
- Review how much of this belongs in:
  - Overview
  - Properties
  - Addons
  - future Logs/Console tabs or drawers

### Validation Rules

- A user can tell why an instance is not startable or not healthy without opening source files.
- Runtime warnings and maintenance states are visible in the primary Instances workflow.
- Console and logs are discoverable from the selected instance without cluttering the default view.

### Implementation Notes

- Focused the Phase 9 work in the existing Instances workspace rather than adding new routes or tabs:
  - [src/web/src/pages/InstancesPage.tsx](/home/turtle/chroma/src/web/src/pages/InstancesPage.tsx)
  - [src/web/src/styles.css](/home/turtle/chroma/src/web/src/styles.css)
- Added a dedicated workspace notice stack that translates runtime state, update state, and blocked-start validation issues into plain-language operator guidance directly in the right pane.
- The new notice model now surfaces, from the primary workflow:
  - explicit blocked-start reasons from Phase 2 validation
  - maintenance-in-progress messaging
  - degraded runtime messaging
  - unknown/error runtime warnings
  - “ready to start” state for clean stopped instances
  - update-available messaging when the latest known BDS version is newer than the instance version
  - runtime notes emitted by the backend
- Updated start-action handling so structured start validation failures are retained in local workspace state instead of only showing as a transient top-level error banner.
- Kept console and logs discoverable through the existing top-right control bar and `Logs` tab, while preserving the current uncluttered tab structure.
- Added a dedicated Properties-tab note explaining that saving `server.properties` while the instance is running still requires a restart before changes take effect.

### Validation Notes

- Ran `pnpm typecheck` successfully.
- Ran `pnpm build` successfully.
- Rebuilt the staged `.runtime` app with `./dev/dev-run.sh -build`.
- Performed staged `.runtime` Phase 9 data-path validation on June 19, 2026:
  - logged into the staged runtime
  - started `inst_44c2014e26` and confirmed the runtime returned `running` + `healthy`
  - attempted to start `inst_8b4ae23836` while `inst_44c2014e26` was already bound to the default BDS ports
  - confirmed `POST /api/instances/:instanceId/bds/start` returned a structured `409` validation payload containing:
    - shared-instance IPv4 conflict
    - shared-instance IPv6 conflict
    - host IPv4 port unavailable
    - host IPv6 port unavailable
  - confirmed the Properties-tab backing payload still returns `restartRequired=true` while the selected instance is running
- Validation note:
  - this phase was validated through the staged runtime, compile/build checks, and live API data paths that feed the workspace. A browser-visual screenshot pass was not performed in this phase.

### Status

Completed on the current branch/worktree. Phase 9 now turns existing runtime, validation, and update data into clearer inline operator guidance inside the Instances workspace without adding additional navigation or product surface area.

## Phase 10: Manual Validation Matrix and Operational Docs

### Objective

Codify a repeatable validation model for Chroma-managed runtime behavior.

### Scope

- Add a manual validation checklist covering:
  - normal start
  - normal stop
  - restart
  - duplicate port conflict
  - external port conflict
  - crash on start
  - Chroma restart reconciliation
  - manual update
  - automatic update
  - backup while stopped
  - backup during maintenance workflow
  - console command flow
  - log visibility
- Document expected outcomes and cleanup steps for each test.
- Keep the validation model aligned with `.runtime`.

### Validation Rules

- A developer can run through the checklist end-to-end on a local `.runtime` environment.
- Every major runtime path has a documented expected result.
- Regressions in runtime behavior can be reproduced consistently.

### Implementation Notes

- Added the Phase 10 manual validation document in:
  - [docs/dev/chroma-runtime-validation-matrix.md](/home/turtle/chroma/docs/dev/chroma-runtime-validation-matrix.md)
- The checklist is aligned to the existing `.runtime` development model and documents:
  - shared environment/setup expectations
  - expected outcomes for each major lifecycle and maintenance path
  - cleanup steps so repeated validation runs stay consistent
- Covered the runtime paths called out in this roadmap phase:
  - normal start
  - normal stop
  - restart
  - duplicate port conflict
  - external port conflict
  - crash on start
  - Chroma restart reconciliation
  - manual update
  - automatic update
  - backup while stopped
  - backup during maintenance workflow
  - console command flow
  - log visibility

### Validation Notes

- Reviewed the checklist against the implemented runtime surfaces in the current branch/worktree:
  - runtime lifecycle controls
  - validation/conflict handling
  - reconciliation behavior
  - update flows
  - backup export flow
  - console stream
  - log viewer
- The matrix itself was added as the repeatable operator/developer validation artifact for future `.runtime` passes.
- A fresh end-to-end rerun of every checklist item was not performed as part of this documentation-only phase completion update.

### Status

Completed on the current branch/worktree. Phase 10 now has a concrete `.runtime`-aligned validation matrix and cleanup guidance so runtime regressions can be re-tested consistently.

## Feature Enhancement: Runtime Broker Service

### Objective

Introduce a dedicated Chroma runtime broker that owns BDS process supervision, live console transport, and reconnection semantics more cleanly than the current in-process Fastify lifecycle model.

### Why This Is A Follow-On Enhancement

- The current phased roadmap keeps Chroma-managed runtime simple enough to ship incrementally.
- A broker service would improve resilience for:
  - live console continuity
  - shared writer console sessions
  - restart/recovery behavior
  - separation between web/API restarts and BDS process ownership
- This enhancement is intentionally deferred until the core Chroma-managed runtime model is validated end to end.

### Candidate Responsibilities

- Own the long-lived BDS child processes and their stdin/stdout/stderr channels.
- Expose a narrow control surface to the main Chroma server for:
  - start
  - stop
  - restart
  - update/maintenance sequencing
  - console attach/detach
- Maintain bounded console buffers and shared-writer fan-out per instance.
- Persist enough broker metadata to survive Chroma API restarts without dropping console/control state.
- Emit structured lifecycle and console events for indexing into the per-instance event log model.

### Validation Rules

- Restarting the main Chroma web/API process does not force a loss of console control for already running instances.
- Multiple authenticated admins can attach to the same instance console and share one live command/output stream.
- Recovery behavior is clearer and less degraded than the current PID-rediscovery-only model.

## Completion Definition

The overall objective is complete when:

- Chroma blocks invalid starts before spawning BDS.
- Chroma verifies successful starts instead of assuming them.
- Chroma has a documented reconciliation model after its own restart.
- Chroma exposes runtime events, logs, and live console access through the product.
- Maintenance flows are runtime-aware and safe.
- The Instances workspace clearly communicates runtime health and operator actions.
- The manual validation matrix can be used to confirm behavior in `.runtime`.

## Open Questions / Design Decisions

The following design decisions are now treated as settled for implementation planning:

1. During reconciliation, if Chroma rediscovers a surviving BDS process after an unclean Chroma shutdown, it should resume monitoring that process and record clear reconciliation events.
2. Per-instance event history should use a file-first model with SQLite summary/index records for querying, filtering, and future dashboard use.
3. Historical BDS raw output should remain separate from Chroma management events, and both should remain separate from the live console experience.
