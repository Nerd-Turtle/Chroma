# Instances

## Overview

An Instance is the core managed object in Chroma Server Manager.

An Instance is a self-contained Minecraft Bedrock Dedicated Server profile. It owns its own Bedrock server version, server configuration, world data, addons, backups, logs, and runtime state.

Chroma manages Instances. Chroma itself should not mix Instance data together or treat addons, worlds, or settings as global unless they are truly application-level settings.

## Definition

An Instance represents one manageable Bedrock Dedicated Server environment.

Each Instance should be isolated from other Instances.

An Instance includes:

- Backend ID
- Friendly name
- Bedrock Dedicated Server version
- Server settings
- Active world
- Installed addons
- Enabled addons
- Addon order
- Backups
- Logs
- Runtime state
- Job history

Conceptually:

```text
Instance
├─ Metadata
├─ BDS files
├─ Server settings
├─ World
├─ Addons
├─ Backups
├─ Logs
└─ Jobs
```

## Instance Ownership

An Instance owns its own data.

Instance-specific data includes:

- `server.properties`
- Bedrock server files
- World files
- Behavior packs
- Resource packs
- Installed addon source files
- Extracted addon files
- Addon metadata
- Enabled addon state
- Backup files
- Instance logs
- Instance job records

Chroma should not share addon installations between Instances.

If the same CurseForge addon is installed on two Instances, each Instance should have its own copy and its own addon metadata.

## Backend IDs

Instances should use a stable backend ID.

The backend ID is used for:

- Database records
- API routes
- Filesystem paths
- Logs
- Job references
- Backup references

The backend ID should not be based on the friendly name.

Recommended format:

```text
inst_<random>
```

Example:

```text
inst_9f3a27c1b0
```

A short random ID is acceptable. A full UUID is not required unless the project later needs it.

## Friendly Names

The friendly name is the user-visible name shown in the UI.

Examples:

```text
Kids Survival
Creative Test
Family Realm
Addon Test Server
```

Friendly names do not need to be globally unique at the filesystem level because the backend ID is the true identifier.

The UI may warn about duplicate friendly names, but duplicate names should not break the backend.

## Instance Paths

In production, Instance data should live under:

```text
/var/lib/chroma/instances/
```

Example:

```text
/var/lib/chroma/instances/inst_9f3a27c1b0/
```

In development, Instance data should live under:

```text
.runtime/var/lib/chroma/instances/
```

Example:

```text
.runtime/var/lib/chroma/instances/inst_9f3a27c1b0/
```

The preferred Instance path format is:

```text
instances/<instance-id>/
```

Using only the backend ID keeps paths stable even if the user renames the Instance.

## Suggested Instance Directory Layout

An Instance should separate Bedrock Dedicated Server files from Chroma-managed metadata.

Recommended layout:

```text
instances/inst_9f3a27c1b0/
├─ bds/
│  ├─ bedrock_server
│  ├─ server.properties
│  ├─ allowlist.json
│  ├─ permissions.json
│  ├─ worlds/
│  ├─ behavior_packs/
│  └─ resource_packs/
│
└─ csm/
   ├─ metadata.json
   ├─ addons/
   ├─ backups/
   ├─ logs/
   └─ jobs/
```

The `bds/` directory should contain files that belong to Bedrock Dedicated Server.

The `csm/` directory should contain files that belong to Chroma.

## Instance Metadata

Each Instance should have metadata stored in the database.

Chroma may also write a `metadata.json` file inside the Instance directory for easier inspection, recovery, or troubleshooting.

Example metadata fields:

```text
id
friendlyName
bdsVersion
status
createdAt
updatedAt
instancePath
activeWorldName
```

Possible TypeScript shape:

```ts
export type InstanceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export type Instance = {
  id: string;
  friendlyName: string;
  status: InstanceStatus;
  bdsVersion: string;
  instancePath: string;
  activeWorldName?: string;
  createdAt: string;
  updatedAt: string;
};
```

## Instance Status

Instance status describes the current runtime state of the Bedrock server.

Initial statuses:

```text
stopped
starting
running
stopping
error
```

Possible future statuses:

```text
updating
backing_up
restoring
unknown
```

Chroma should avoid pretending an Instance is healthy just because a database value says it is running.

Runtime status should eventually be verified against the actual Bedrock server process.

## Instance Creation Workflow

The Create Instance workflow should guide the user through creating a new Bedrock Dedicated Server profile.

Initial workflow:

```text
Create Instance
├─ Name Instance
├─ Select BDS version
├─ Configure initial BDS settings
├─ Create or import world
├─ Select addons for this Instance
└─ Review and create
```

The first version of this workflow may create a placeholder Instance before full BDS download support exists.

## Instance Import Workflow

Chroma should eventually support importing an existing Bedrock Dedicated Server folder.

Import workflow:

```text
Import Instance
├─ Select existing BDS folder
├─ Scan server files
├─ Detect server.properties
├─ Detect worlds
├─ Detect behavior packs
├─ Detect resource packs
├─ Detect enabled world packs
├─ Show import summary
└─ Register Instance
```

Importing should not immediately modify the existing server files unless the user confirms.

## Instance Operations

Basic Instance operations:

```text
Start
Stop
Restart
View status
View logs
```

Operations should eventually be represented as jobs when they are long-running, risky, or need user-visible progress.

Start, stop, and restart should write useful logs so the user can troubleshoot server launch issues.

## Instance Server Settings

Users should configure Bedrock server settings through the Chroma UI.

Users should not need to manually edit `server.properties` during normal use.

Initial settings to expose:

```text
server-name
gamemode
difficulty
allow-cheats
max-players
online-mode
server-port
server-portv6
view-distance
tick-distance
default-player-permission-level
texturepack-required
player-idle-timeout
```

Advanced settings can be added later.

Chroma should map UI fields to Bedrock server configuration values.

## Instance Addons

Addons belong to a specific Instance.

An Instance can have:

```text
Installed addons
Enabled addons
Disabled addons
Addon order
Addon update state
Addon conflict warnings
```

Installing an addon and enabling an addon are separate actions.

Installing an addon downloads, extracts, parses, and registers it for the Instance.

Enabling an addon applies it to the Instance’s active world/server configuration.

Addon details belong in `docs/Addons.md`.

## Instance Addon Order

Each Instance should maintain its own addon order.

Addon order matters because multiple addons may affect similar resources or behavior.

The user should eventually be able to reorder enabled addons.

The order shown in the UI should match the order written into Bedrock world pack configuration files.

## Instance Updates

Instance updates include:

```text
BDS update
Addon update
Configuration migration
```

Updating BDS should be treated as risky.

Before updating BDS, Chroma should recommend or require a backup.

Update workflow:

```text
Check for update
├─ Show current version
├─ Show target version
├─ Show addon warnings
├─ Create backup
├─ Stop Instance
├─ Apply update
├─ Start Instance
└─ Show result
```

Addon updates are Instance-specific. Updating an addon in one Instance must not update the same addon in another Instance.

## Instance Backups

Backups are Instance-specific.

An Instance backup may include:

```text
BDS config
World files
Enabled addon state
Installed addon metadata
Chroma metadata
```

Backup types may include:

```text
Full Instance backup
World-only backup
Config-only backup
Pre-update backup
Pre-restore safety backup
```

Initial versions can start with manual full Instance backups.

Before risky actions, Chroma should offer or require a backup.

Risky actions include:

```text
BDS update
Addon update
Addon enable/disable
Addon removal
World restore
Major server setting changes
```

## Instance Logs

Each Instance should expose relevant logs in the UI.

Log types:

```text
Bedrock server logs
Chroma job logs
Operation logs
Error history
```

Logs should help answer:

```text
Did the server start?
Why did it stop?
Did an addon fail to install?
Did a backup complete?
Did an update fail?
```

## Instance Jobs

Jobs represent operations that may take time, fail, or need progress tracking.

Instance jobs may include:

```text
Download BDS
Install BDS
Start Instance
Stop Instance
Restart Instance
Install addon
Enable addon
Disable addon
Update addon
Update BDS
Create backup
Restore backup
Collect logs
```

Jobs should include:

```text
id
instanceId
type
status
createdAt
startedAt
completedAt
message
error
```

Recommended job ID format:

```text
job_<random>
```

## Instance Safety Rules

Chroma should not silently perform destructive Instance operations.

Chroma should avoid:

- Overwriting worlds without confirmation
- Removing addons without confirmation
- Updating BDS without warning
- Updating addons without warning
- Restoring backups without a safety backup or explicit confirmation
- Rewriting important config without showing what changed

Chroma should prefer:

- Clear review screens
- Confirmation prompts
- Pre-change backups
- Job logs
- Error explanations
- Rollback options where practical

## Initial Implementation Target

The first implementation should be small.

Initial backend behavior:

```text
GET /api/instances
  Return all Instances.

POST /api/instances
  Create a placeholder Instance record.

GET /api/instances/:instanceId
  Return one Instance.

GET /api/instances/:instanceId/addons
  Return addons for one Instance.
```

Initial UI behavior:

```text
Show Instance list
Show Create Instance button
Show placeholder Instance detail page
```

Initial CLI behavior:

```text
csm instances
csm instance <id>
```

The first version does not need to download or run Bedrock Dedicated Server.

The first goal is to prove the Instance model and UI/API flow.

## Design Rules

- Instance is the primary managed object.
- Addons are scoped to Instances.
- Backend IDs are stable and separate from friendly names.
- Friendly names are user-facing.
- Paths should use backend IDs.
- Runtime data belongs under `.runtime/var/lib/chroma` in development.
- Runtime data belongs under `/var/lib/chroma` in production.
- User data should not be stored in `/opt/chroma`.
- Risky Instance changes should be confirmed or backed up.
