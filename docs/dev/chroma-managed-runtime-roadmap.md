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
