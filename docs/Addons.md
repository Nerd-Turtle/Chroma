# Addons

## Overview

Chroma Server Manager manages addons at the Instance level.

Chroma does not maintain a global addon library. Addons belong to individual Instances. If the same addon is installed on multiple Instances, each Instance owns and manages its own copy of that addon.

This keeps Instances isolated and reduces the risk that an addon update or configuration change for one Instance accidentally affects another Instance.

## Core Design Rule

Addons are scoped to Instances.

```text id="vfm0rq"
Chroma
└─ Instance
   └─ Addons
```

There is no global Chroma addon library.

Example:

```text id="8wmzjb"
Instance: Kids Survival
└─ Actions & Stuff v1.2.0

Instance: Creative Test
└─ Actions & Stuff v1.3.0
```

These are separate addon installations, even if they came from the same CurseForge project.

## Addon Sources

Initial addon sources:

```text id="kpl73m"
CurseForge
Manual import
```

CurseForge support is the primary intended source.

Manual import may support files such as:

```text id="fl52eu"
.mcaddon
.mcpack
.zip
folder import
```

Manual import should be treated as untrusted input.

## Addon Lifecycle

Addon lifecycle should be separated into clear states and actions.

Primary lifecycle actions:

```text id="ixy7pa"
Search
Install
Enable
Disable
Update
Remove
```

## Search Addon

Searching an addon means querying an addon source such as CurseForge.

Search should allow the user to find addons that may be compatible with the selected Instance.

Search may use filters such as:

```text id="rmt00s"
Minecraft version
Bedrock support
Addon category
Popularity
Last updated
Release type
Search keyword
```

Search results are not installed addons.

A search result only becomes an Instance addon after the user chooses to install it.

## Install Addon

Installing an addon means downloading, storing, extracting, parsing, and registering the addon for a specific Instance.

Install does not necessarily mean the addon is active in the Minecraft world.

Install workflow:

```text id="a5my9g"
Browse or search CurseForge
├─ Select addon
├─ Select addon file/version
├─ Download addon file
├─ Store original addon file
├─ Extract addon safely
├─ Locate manifest.json files
├─ Parse pack metadata
├─ Detect behavior packs
├─ Detect resource packs
├─ Extract UUIDs
├─ Extract pack versions
├─ Extract dependencies
├─ Extract minimum engine version
├─ Build file inventory
├─ Register addon with the Instance
└─ Mark addon as installed
```

After installation, the addon is known to the Instance but may still be disabled.

## Enable Addon

Enabling an addon means applying an installed addon to the Instance so Bedrock Dedicated Server can use it.

Enable workflow:

```text id="ybejo4"
Select installed addon
├─ Check addon metadata
├─ Check dependencies
├─ Check addon order
├─ Copy or stage pack files
├─ Update world_behavior_packs.json
├─ Update world_resource_packs.json
├─ Mark addon as enabled
└─ Prompt for restart if needed
```

Enabling an addon may require modifying the active world configuration.

If the Instance is running, Chroma should warn that changes may not take effect until the Instance restarts.

## Disable Addon

Disabling an addon means removing it from the active Instance configuration without deleting the installed addon.

Disable workflow:

```text id="m1m4d1"
Select enabled addon
├─ Remove pack UUID/version from world pack config
├─ Preserve installed addon files
├─ Mark addon as disabled
└─ Prompt for restart if needed
```

Disabling should not delete the addon unless the user explicitly chooses remove/delete.

## Remove Addon

Removing an addon means deleting the installed addon from the Instance.

Remove workflow:

```text id="0lo4qm"
Select installed addon
├─ Warn user
├─ Disable addon if currently enabled
├─ Remove addon metadata
├─ Remove stored original file
├─ Remove extracted addon files
└─ Remove addon from Instance
```

Remove is destructive and should require confirmation.

## Update Addon

Addon updates are Instance-specific.

Updating an addon in one Instance must not update the same addon in another Instance.

Update workflow:

```text id="niv8r0"
Check CurseForge for newer file
├─ Compare installed version
├─ Show current version
├─ Show target version
├─ Show compatibility notes
├─ Create backup or restore point
├─ Download new addon file
├─ Extract and parse new addon
├─ Replace or stage addon files
├─ Preserve enable/disable state where possible
├─ Re-apply addon order
└─ Mark update complete
```

If the update fails, Chroma should preserve the previous working addon version where practical.

## Installed vs Enabled

Installed and enabled are different states.

```text id="xer6qa"
Installed
  The addon has been downloaded, extracted, parsed, and registered for the Instance.

Enabled
  The addon is active in the Instance's Bedrock world/server configuration.
```

An addon can be:

```text id="ewyitx"
installed and disabled
installed and enabled
installed with update available
installed with error
```

## Addon Order

Each Instance maintains its own addon order.

Addon order controls how enabled addons are applied to the Instance.

This matters because multiple addons may modify similar behavior, resources, textures, entities, scripts, or configuration files.

Users should eventually be able to control addon order.

Initial UI options may include:

```text id="uxmbjg"
Move up
Move down
Send to top
Send to bottom
```

Future UI may support drag-and-drop ordering.

The order shown in the UI should match the order written to Bedrock world pack configuration files.

## Addon Conflicts

Multiple addons may include overlapping files or conflicting metadata.

Chroma should eventually detect and warn about possible conflicts.

Potential conflict examples:

```text id="6j8z7a"
Two addons include the same relative file path.
Two addons modify the same entity.
Two addons include incompatible dependencies.
Two addons require different Minecraft/BDS versions.
Two addons contain conflicting pack metadata.
```

Initial conflict detection can be simple.

For example, Chroma can build a file inventory during install and warn when two enabled addons contain the same relative path.

Chroma does not need to automatically solve all conflicts.

The first goal is to make possible conflicts visible to the user.

## Addon File Inventory

During install, Chroma should eventually build an inventory of files contained in the addon.

File inventory may include:

```text id="n8tm3r"
addonId
packType
relativePath
fileSize
checksum
```

This inventory can help detect overlap between enabled addons.

## Addon Metadata

Each Instance addon should track useful metadata.

Suggested fields:

```text id="ldgmta"
id
instanceId
friendlyName
source
status
enabled
loadOrder
curseForgeProjectId
curseForgeFileId
version
minecraftVersions
minEngineVersion
behaviorPackIds
resourcePackIds
dependencies
originalFileName
originalFilePath
extractedPath
installedAt
updatedAt
lastEnabledAt
lastDisabledAt
```

Possible TypeScript shape:

```ts id="k7k3dq"
export type AddonSource = "curseforge" | "manual";

export type InstanceAddonStatus =
  | "installed"
  | "enabled"
  | "disabled"
  | "update_available"
  | "error";

export type InstanceAddon = {
  id: string;
  instanceId: string;
  friendlyName: string;
  source: AddonSource;
  status: InstanceAddonStatus;
  enabled: boolean;
  loadOrder: number;

  curseForgeProjectId?: string;
  curseForgeFileId?: string;

  version?: string;
  minecraftVersions: string[];
  minEngineVersion?: string;

  behaviorPackIds: string[];
  resourcePackIds: string[];
  dependencies: string[];

  originalFileName?: string;
  originalFilePath?: string;
  extractedPath: string;

  installedAt: string;
  updatedAt: string;
  lastEnabledAt?: string;
  lastDisabledAt?: string;
};
```

The final implementation may use separate tables for addon files, packs, and dependencies if needed.

## Addon IDs

Addons should use stable backend IDs.

Recommended format:

```text id="m6doqh"
addon_<random>
```

Example:

```text id="0gbxgw"
addon_71b3d09a2c
```

Addon IDs are scoped as backend identifiers. They should not be based on addon names.

## Addon Directory Layout

Addons should live under their owning Instance.

Recommended layout:

```text id="6fadf5"
instances/inst_9f3a27c1b0/
└─ csm/
   └─ addons/
      └─ addon_71b3d09a2c/
         ├─ source/
         │  └─ original.mcaddon
         ├─ extracted/
         ├─ metadata.json
         └─ file-index.json
```

The source file should be preserved where practical.

The extracted directory should contain the unpacked addon content.

The metadata file should describe what Chroma parsed from the addon.

The file index should support future conflict detection.

## Applying Addons to BDS

When an addon is enabled, Chroma should apply the addon to the Bedrock Dedicated Server structure for the Instance.

Likely BDS locations:

```text id="u4n54s"
bds/behavior_packs/
bds/resource_packs/
bds/worlds/<world-name>/world_behavior_packs.json
bds/worlds/<world-name>/world_resource_packs.json
```

Chroma should avoid requiring users to edit these files manually.

## Behavior Packs and Resource Packs

An addon may contain:

```text id="qzb3aj"
Behavior pack only
Resource pack only
Both behavior pack and resource pack
Multiple packs
```

Chroma should parse addon content and detect what pack types are included.

The addon UI should make this visible to the user.

Example:

```text id="zkvy7a"
Actions & Stuff
├─ Behavior pack: yes
├─ Resource pack: yes
├─ Dependencies: yes
└─ Minimum engine version: 1.21.x
```

## Dependencies

Some addons may depend on other packs or specific versions.

Chroma should parse dependencies from pack manifests where possible.

If an addon requires another pack that is missing, Chroma should warn the user before enabling it.

Future behavior may include:

```text id="hpueqx"
Auto-detect missing dependencies
Suggest required addons
Install dependencies automatically with user confirmation
Block enable if required dependency is missing
```

Initial behavior can be warning-only.

## CurseForge Integration

CurseForge search and install should be Instance-focused.

The user should browse CurseForge from within an Instance context.

Example workflow:

```text id="c52i4x"
Instance
└─ Addons
   └─ Browse CurseForge
      ├─ Search
      ├─ Filter
      ├─ Select addon
      ├─ Select file/version
      └─ Install to this Instance
```

CurseForge metadata to track:

```text id="j57l2w"
project ID
file ID
project slug
project name
file name
file version
download URL or file reference
Minecraft versions
release type
published date
```

Chroma should not assume every CurseForge result is compatible with Bedrock Dedicated Server.

Compatibility detection should be explicit and cautious.

## Manual Import

Manual import should support user-provided addon files.

Possible formats:

```text id="hlh6r0"
.mcaddon
.mcpack
.zip
folder
```

Manual imports should be validated carefully.

Safety requirements:

```text id="25nhcb"
Treat files as untrusted
Validate archive paths
Prevent path traversal
Do not overwrite files silently
Reject or warn on malformed manifests
Preserve original import file where practical
```

## Safety Rules

Addon operations can break an Instance.

Risky addon actions include:

```text id="bq0du0"
Enable addon
Disable addon
Update addon
Remove addon
Reorder enabled addons
```

Chroma should use warnings, confirmation prompts, backups, or review screens for risky addon actions.

Before major addon changes, Chroma should offer or require an Instance backup.

## Initial Implementation Target

The first implementation should not attempt full CurseForge and addon installation support.

Initial backend behavior:

```text id="j9rl2s"
GET /api/instances/:instanceId/addons
  Return addons for one Instance.

POST /api/instances/:instanceId/addons/search
  Placeholder for future CurseForge search.

POST /api/instances/:instanceId/addons/install
  Placeholder for future install workflow.

POST /api/instances/:instanceId/addons/:addonId/enable
  Placeholder for future enable workflow.

POST /api/instances/:instanceId/addons/:addonId/disable
  Placeholder for future disable workflow.
```

Initial UI behavior:

```text id="z29qsj"
Show Addons tab inside Instance detail page.
Show installed addons for the selected Instance.
Show placeholder Browse CurseForge button.
Show placeholder enable/disable controls.
```

The first goal is to preserve the correct addon model:

```text id="4sdton"
Addons belong to Instances.
Install and enable are separate operations.
Addon order belongs to an Instance.
```

## Design Rules

- Chroma does not have a global addon library.
- Addons belong to Instances.
- The same addon installed on two Instances is two separate addon installations.
- Installing an addon and enabling an addon are separate actions.
- Disabling an addon should not delete it.
- Removing an addon is destructive and requires confirmation.
- Addon order is Instance-specific.
- Addon order should be user-controllable.
- Chroma should warn about possible addon conflicts where practical.
- Chroma should not silently overwrite addon, world, or BDS files.
- CurseForge browsing should happen in an Instance context.
