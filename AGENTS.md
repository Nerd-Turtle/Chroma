# AGENTS.md

## Project

Chroma Server Manager, abbreviated CSM, is an application hosted on Ubuntu 26.04 that provides management of Minecraft Bedrock Dedicated Server instances and addons.

## Primary Goal

This project is primarily for learning TypeScript, React, Node.js, Fastify, SQLite, and CLI development.

Agent assistance should be limited, instructional, and incremental. Do not make large unexplained changes.

## Stack

- TypeScript
- React + Vite frontend
- Node.js + Fastify backend
- SQLite database
- Commander CLI
- Ubuntu Linux host support only
- Docker may exist as a placeholder only

## Repository Layout

- src/server contains the Fastify backend and server-side logic.
- src/web contains the React/Vite frontend.
- src/cli contains the Commander CLI.
- src/shared contains shared TypeScript types, schemas, and constants.
- install/ubuntu contains Ubuntu install assets.
- install/docker is a placeholder only.
- dev/scripts contains developer helper scripts.
- dev/fixtures contains sample development files.
- docs contains project documentation.
- .runtime is a local disposable development runtime and must not be committed.

## Product Model

- CSM manages Instances.
- An Instance is a self-contained Bedrock Dedicated Server profile.
- Each Instance has its own BDS version, server settings, world, addons, logs, and backups.
- Users should configure Bedrock server settings through the UI.
- Users should not need to manually edit Bedrock server files during normal use.
- Installed addons and enabled addons are different states.
- CurseForge addon browsing and installation should eventually be integrated into the UI.

## Development Rules

- Keep the repo simple.
- Do not create a monorepo or workspace structure unless explicitly requested.
- Do not add Windows support.
- Do not build large features without approval.
- Prefer small, understandable changes.
- Explain important TypeScript, React, Fastify, SQLite, or CLI choices when making them.
- Keep route handlers thin.
- Put reusable backend logic in services.
- Keep UI logic in React components.
- Keep shared frontend/backend types in src/shared.
- Do not duplicate logic between server and CLI.

## Runtime Path Rules

Production paths are:

- Application: /opt/chroma
- Config: /etc/chroma
- Data: /var/lib/chroma
- Logs: /var/log/chroma

Development runtime paths should use .runtime:

- .runtime/opt/chroma
- .runtime/etc/chroma
- .runtime/var/lib/chroma
- .runtime/var/log/chroma

Do not hard-code repo-relative paths for runtime data.

## Safety Rules

- Treat addon files as untrusted input.
- Validate file paths.
- Prevent path traversal.
- Do not allow arbitrary command execution from API input.
- Do not silently overwrite worlds, configs, addons, or backups.
- Risky operations should require confirmation or create a backup first.

## Manual Testing Model

This project may use manual testing instead of automated tests.

Manual development testing should use .runtime.

Build, lint, typecheck, and manual smoke testing are acceptable validation steps.

## Before Marking Work Complete

Report:

- What changed
- Files created or modified
- Commands run
- Whether lint/typecheck/build passed
- How manual testing was performed
- Any issues or TODOs

## Do Not Do

- Do not create a complex repo structure.
- Do not add unsupported operating systems.
- Do not add automated test frameworks unless explicitly requested.
- Do not silently install major dependencies without explaining why.
- Do not make destructive filesystem changes.
