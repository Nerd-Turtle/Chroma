# Chroma Runtime Manual Validation Matrix

## Purpose

This checklist is the repeatable manual validation model for the Chroma-managed BDS runtime.

Use it when validating lifecycle, maintenance, console, and observability behavior in the local `.runtime` environment.

## Environment

- Host OS: Ubuntu
- Runtime root: `.runtime`
- Application build helper: `./dev/dev-run.sh -build`
- Runtime launcher: `./dev/dev-run.sh`
- Chroma URL: `http://localhost:5173` during local development unless your session uses a different forwarded port

## Shared Test Setup

Before running the matrix:

1. Rebuild the staged app with `./dev/dev-run.sh -build`.
2. Start the local runtime with `./dev/dev-run.sh`.
3. Log in through the Chroma UI.
4. Confirm at least two instances exist so port-conflict cases can be exercised.
5. Keep one shell available for host-level inspection commands such as `ss -lunp`.

Recommended fixture naming:

- `Runtime Primary`
- `Runtime Conflict`

## Checklist

### 1. Normal start

- Setup: choose a stopped instance with a healthy BDS install and no port conflicts.
- Steps:
  1. Open the instance Overview tab.
  2. Start the instance.
  3. Wait for runtime verification to complete.
- Expected:
  - the instance transitions through `starting`
  - final runtime becomes `running`
  - health becomes `healthy` or an explained degraded state
  - recent activity includes start-related entries
  - the Logs and Console entry points remain available
- Cleanup: stop the instance before moving to the next isolated test unless another case needs it running.

### 2. Normal stop

- Setup: use an instance that is currently running.
- Steps:
  1. Stop the instance from the workspace controls.
  2. Wait for the runtime state to settle.
- Expected:
  - runtime leaves `running`
  - final state becomes `stopped`
  - the process is no longer active
  - recent activity records the stop
- Cleanup: none.

### 3. Restart

- Setup: use an instance that is currently running.
- Steps:
  1. Trigger restart from the workspace controls.
  2. Observe status transitions and final state.
- Expected:
  - Chroma records a stop/start cycle or restart-specific lifecycle events
  - final runtime returns to `running`
  - console and logs continue to reflect the new session
- Cleanup: none.

### 4. Duplicate port conflict

- Setup: start `Runtime Primary`, then configure `Runtime Conflict` with the same BDS ports.
- Steps:
  1. Attempt to start `Runtime Conflict`.
  2. Observe the API/UI response.
- Expected:
  - start is blocked before spawn
  - response includes structured validation issues
  - the workspace shows human-readable blocked-start guidance
  - the conflicting instance is not marked as running
- Cleanup: stop `Runtime Primary` if it is no longer needed.

### 5. External port conflict

- Setup: stop the target instance, then bind one of its ports with a separate process on the host.
- Steps:
  1. Confirm the host bind with `ss -lunp`.
  2. Attempt to start the instance from Chroma.
- Expected:
  - start is blocked before spawn
  - validation identifies the host-level port conflict
  - the instance remains stopped
- Cleanup:
  1. Terminate the external process.
  2. Re-run `ss -lunp` to confirm the port is free.

### 6. Crash on start

- Setup: create a known-bad startup condition such as intentionally invalid BDS startup prerequisites in `.runtime`.
- Steps:
  1. Attempt to start the affected instance.
  2. Wait through the startup verification window.
- Expected:
  - Chroma does not treat raw `spawn()` success as a healthy start
  - final runtime becomes `error` or `stopped` with failure context
  - recent log tail and operator-facing messaging help explain the failure
- Cleanup: restore the broken file or setting before continuing.

### 7. Chroma restart reconciliation

- Setup: leave one instance running under Chroma.
- Steps:
  1. Restart the Chroma app process while leaving BDS running if possible in the staged workflow.
  2. Re-open the instance workspace after Chroma is back.
- Expected:
  - reconciliation records clear runtime events
  - Chroma rediscovers or classifies the instance consistently
  - runtime state is not silently reported as healthy without reconciliation evidence
- Cleanup: stop the instance if you do not need it for later checks.

### 8. Manual update

- Setup: use an instance where a newer BDS version is available.
- Steps:
  1. Run the update check from the workspace.
  2. Trigger the manual update action.
  3. Observe maintenance messaging until completion.
- Expected:
  - maintenance state becomes visible while work is in progress
  - the instance version updates on success
  - recent activity records the update workflow
  - runtime returns to a stable post-update state
- Cleanup: none.

### 9. Automatic update

- Setup: use an instance with automatic updates enabled and a due schedule in `.runtime`.
- Steps:
  1. Trigger the scheduler path or wait for the check window in development.
  2. Observe the instance status, events, and version fields.
- Expected:
  - Chroma records the automatic check result
  - update-related events and timestamps are visible
  - final version and runtime state are internally consistent
- Cleanup: reset any temporary scheduling tweaks used for the test.

### 10. Backup while stopped

- Setup: choose a stopped instance.
- Steps:
  1. Trigger an export backup from the workspace.
  2. Wait for the ZIP to be created.
- Expected:
  - backup creation succeeds without needing the instance to run
  - the download starts or the generated file is available through the backup route
  - runtime event history records the backup
- Cleanup: remove the export artifact from `.runtime` if you do not want to keep it.

### 11. Backup during maintenance workflow

- Setup: begin a long-running managed action such as an update flow, then attempt backup behavior relevant to the current product behavior.
- Steps:
  1. Observe the instance while the maintenance state is active.
  2. Trigger or inspect backup handling during that window.
- Expected:
  - Chroma communicates maintenance state clearly
  - backup behavior is either safely blocked or completed in a controlled way
  - the UI does not imply the instance is idle when it is in maintenance
- Cleanup: allow the maintenance action to complete before starting unrelated tests.

### 12. Console command flow

- Setup: use a running instance.
- Steps:
  1. Open the console drawer.
  2. Confirm live output appears.
  3. Send a safe read-only command such as `help` or `list`.
- Expected:
  - the console connects and streams output
  - the command is accepted by Chroma
  - resulting output appears in the shared console stream
- Cleanup: close the drawer or stop the instance.

### 13. Log visibility

- Setup: use an instance with current and historical BDS log data.
- Steps:
  1. Open the `Logs` tab.
  2. View the live tail.
  3. Open an older log file and page through it.
- Expected:
  - the current tail loads
  - historical files are listed with timestamps and sizes
  - paged navigation works without mixing current and historical views
- Cleanup: return the viewer to tail mode if you want the default workspace view restored.

## Cleanup Pass

After the matrix:

1. Stop any instances left running only for validation.
2. Remove temporary host-level conflict processes.
3. Revert any intentionally broken startup files or settings.
4. Remove disposable export artifacts if they are not needed.
5. Record any mismatches between expected and actual behavior before making further code changes.
