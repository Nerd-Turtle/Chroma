# Chroma

## Overview

Chroma Server Manager, abbreviated CSM, is an Ubuntu-first web application for managing Minecraft Bedrock Dedicated Server instances and instance-specific addons.

Chroma is intended to feel conceptually similar to Prism Launcher, but for Bedrock Dedicated Server instances instead of Minecraft client profiles.

The primary goal of Chroma is to make it easier to create, configure, update, back up, and manage Bedrock server instances without requiring users to manually edit server files.

## Product Scope

Chroma manages:

- User login and access to the Chroma web UI
- Chroma dashboard and system status
- Bedrock Dedicated Server instances
- Instance-specific Bedrock server configuration
- Instance-specific addons
- Instance operations such as start, stop, and restart
- Instance updates
- Instance backups
- Chroma application settings

Chroma does not maintain a global addon library.

Addons belong to individual instances. If the same addon is installed on multiple instances, each instance owns and manages its own copy of that addon.

## Core Product Model

The core object in Chroma is an Instance.

An Instance is a self-contained Bedrock Dedicated Server profile. Each Instance has its own Bedrock server version, server settings, world, addons, logs, backups, and runtime state.

Chroma itself is the management layer around those Instances.

```text
Chroma
├─ Login
├─ Dashboard
├─ Instances
└─ Chroma Settings
```

## Primary Screens

### Login

The login page allows an authorized user to access the Chroma web UI.

Initial versions may use a simple local admin account. More advanced authentication can be added later if needed.

### Dashboard

The dashboard provides a high-level view of Chroma and managed Instances.

The dashboard should show:

- Chroma status
- Chroma version
- Instance count
- Running instance count
- Stopped instance count
- Recent activity
- Recent jobs
- Warnings or required actions
- Available Chroma updates, if supported later
- Available Instance updates, if detected later

The dashboard should answer:

```text
Is Chroma running correctly?
Are my instances healthy?
Are any servers running?
Does anything need attention?
```

### Instances

The Instances area is where users create and manage Bedrock Dedicated Server instances.

Instance workflows include:

- Create Instance
- View Instance
- Start Instance
- Stop Instance
- Restart Instance
- Configure Instance
- Install addons for an Instance
- Enable or disable installed Instance addons
- Update BDS for an Instance
- Update addons for an Instance
- Back up an Instance
- Restore an Instance
- View Instance logs

### Chroma Settings

Chroma Settings contains application-level configuration.

Examples include:

- Runtime paths
- Web UI bind address and port
- Chroma update settings
- CurseForge API configuration
- Backup defaults
- Admin/user settings
- Application logs
- Application export or backup settings

Chroma Settings should not be used for configuration that belongs to a specific Instance.

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

The user should not need to manually edit `server.properties` during normal use.

Chroma should write the required Bedrock configuration files based on the options selected in the UI.

## Instance Management Workflow

The Manage Instance workflow is used after an Instance exists.

```text
Manage Instance
├─ Overview
├─ Operations
│  ├─ Start
│  ├─ Stop
│  └─ Restart
├─ Server Settings
├─ Addons
│  ├─ Browse CurseForge
│  ├─ Install addon
│  ├─ Enable addon
│  ├─ Disable addon
│  ├─ Update addon
│  └─ Remove addon
├─ Updates
│  ├─ Update BDS
│  └─ Update addons
├─ Backups
│  ├─ Create backup
│  └─ Restore backup
└─ Logs
```

## Addon Scope

Addons are scoped to Instances.

Chroma should not treat addons as global shared objects. This design keeps instances isolated and reduces the chance that an addon update for one Instance accidentally impacts another Instance.

Example:

```text
Instance: Kids Survival
└─ Actions & Stuff v1.2.0

Instance: Creative Test
└─ Actions & Stuff v1.3.0
```

These are separate addon installations even if they came from the same CurseForge project.

## Install vs Enable

Installing an addon and enabling an addon are separate actions.

Installing an addon means:

```text
Browse/search CurseForge
→ Select addon
→ Download addon
→ Store original addon file
→ Extract addon
→ Parse addon metadata
→ Detect UUIDs and requirements
→ Register addon with the Instance
```

Enabling an addon means:

```text
Apply addon files to the Instance
→ Update Bedrock world pack configuration
→ Respect addon load order
→ Make the addon functional for the Instance
```

Disabling an addon should remove it from the active Instance configuration without deleting the installed addon unless the user explicitly removes it.

## Addon Order

Each Instance should maintain its own addon order.

Addon order controls how enabled addons are applied. This matters because multiple addons may modify similar files or provide overlapping resources.

The user should eventually be able to reorder enabled addons.

Chroma should warn when it detects possible addon conflicts, especially when multiple enabled addons appear to contain overlapping files or pack metadata.

## Backend Identifiers

Chroma should use stable backend IDs that are separate from user-facing names.

Friendly names are for users. Backend IDs are for the database, API, filesystem references, logs, and internal operations.

Recommended ID style:

```text
inst_<random>
addon_<random>
job_<random>
backup_<random>
```

Examples:

```text
inst_9f3a27c1b0
addon_71b3d09a2c
job_44e9a11df0
backup_a891cb2771
```

Friendly names do not need to be globally unique.

Backend IDs must be unique.

## Friendly Names, Slugs, and Paths

Instances should have:

- A backend ID
- A friendly name
- Optionally, a slug

The friendly name is shown in the UI.

The backend ID is used internally.

The slug may be used for readable labels, but should not be the only unique identifier.

Changing a friendly name should not require moving the Instance directory.

## Safety Principles

Chroma should be careful with operations that can break a server, world, or addon configuration.

Risky actions include:

- Updating BDS
- Updating addons
- Enabling addons
- Disabling addons
- Removing addons
- Restoring backups
- Changing active worlds
- Changing important server settings

For risky actions, Chroma should use one or more of the following:

- Confirmation prompts
- Clear warnings
- Pre-change backups
- Review screens
- Job logs
- Rollback options where practical

Chroma should never silently overwrite worlds, server configuration, addons, or backups.

## Runtime Model

Chroma has a development runtime and a production runtime.

Development runtime data lives under:

```text
.runtime/
```

Production runtime data should use:

```text
/opt/chroma      application files
/etc/chroma      configuration
/var/lib/chroma  persistent data
/var/log/chroma  logs
```

User data should not be stored in `/opt/chroma`.

Instance data, addons, worlds, backups, and the Chroma database should live under `/var/lib/chroma` in production.

## Design Direction

Chroma should prioritize:

- Simple instance creation
- Safe Bedrock server configuration
- Clear addon install and enable workflows
- Instance isolation
- Safe updates
- Backups before risky changes
- A UI-first management experience
- Minimal need for manual file editing

Chroma should avoid:

- Global addon state
- Complex enterprise-style architecture
- Hidden destructive actions
- Manual file editing as a normal workflow
- Large unsupported platform scope
- Windows support unless explicitly added later
