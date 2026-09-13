# Production installer validation — 2026-09-12

## Result

The initial findings below describe installer commit `39b411e`. The version-handling
fix was subsequently implemented and retested; see the follow-up section at the end.

Fresh installation passed on Ubuntu 24.04 and 26.04 AMD64 using the production
installer and matching prebuilt archives. Both VMs were left running Chroma with
initial setup untouched. Rerunning the installer for the installed version failed
on both VMs and left the service stopped; the service was manually restored.

No repository was cloned, source code copied, or application code compiled on
either target VM. No provider credentials were used. Application and installer
code were not changed as part of this validation.

## Targets and release

| Item | Ubuntu 24 VM | Ubuntu 26 VM |
| --- | --- | --- |
| Address | `192.168.76.71` | `192.168.76.241` |
| Hostname | `mc-u24` | `mc-u26` |
| OS | Ubuntu 24.04.5 LTS | Ubuntu 26.04.1 LTS |
| Kernel | `6.8.0-139-generic` | `7.0.0-31-generic` |
| Architecture | AMD64 | AMD64 |
| Existing Chroma installation | None | None |
| Ports 80 and 443 before installation | Free | Free |
| UFW | Not installed | Not installed |
| Node.js, pnpm, Git on target PATH | Absent before and after | Absent before and after |
| First successful service start, UTC | 14:52:43 | 14:50:12 |

Tested package version: `0.1.0`.

Source commit in both installed archives:
`39b411e514363711ac91219eca6ec3dac82c677d`.

The Ubuntu 26.04 archive was built on the development host. The Ubuntu 24.04
archive was built with fresh dependencies in a separate local Ubuntu 24.04 LXD
container. Neither target VM was used as a build machine. The Node.js runtime
bundled in both archives is `24.19.0`.

## Download path and commands

There were no GitHub releases at test time. The default GitHub latest-release
download URL returned HTTP 404. The existing local release archive also predated
the startup fix, so fresh archives were built from the tested commit.

The fresh assets were served temporarily from the development host at
`http://192.168.76.25:18080`. The install script was unchanged; its existing
`--release-base-url` option selected the test asset server. This validates the
installer's download, checksum, extraction, configuration, and service workflow,
but does not validate a published GitHub release download.

Build command, run on each matching build OS:

```bash
./dev/scripts/build-release.sh --output <release-output-directory>
```

Fresh-install commands, run on each target VM:

```bash
curl --fail --show-error --silent \
  http://192.168.76.25:18080/install-chroma.sh \
  -o /tmp/chroma-install-validation-39b411e.sh
sha256sum /tmp/chroma-install-validation-39b411e.sh
sudo bash /tmp/chroma-install-validation-39b411e.sh \
  --version 0.1.0 \
  --release-base-url http://192.168.76.25:18080
```

Artifact SHA-256 digests:

| Artifact | SHA-256 |
| --- | --- |
| `install-chroma.sh` | `2dff6a1129099863dbb0a0f243204a5e83311fca6ce573d692b269f4cce81a95` |
| `chroma-ubuntu-24.04-amd64.tar.gz` | `32689ac739aa6e1cc25227de4e9438618391f6818695894f9ba865fbbca524b5` |
| `chroma-ubuntu-26.04-amd64.tar.gz` | `abfe6608431c33eed283c673980444c922963508964b1df9643c47c69f425ca5` |

## Observations and checks

Both fresh installs completed without errors or manual repair. The installer
selected the correct OS archive, verified its checksum, installed under
`/opt/chroma/releases/0.1.0`, created the `current` symlink, generated a self-signed
certificate, and enabled and started `chroma.service`. Existing prerequisite
packages were sufficient; no prerequisite package installation was exercised on
these VMs.

The following checks passed on both VMs:

- `systemctl is-active` returned `active`; `is-enabled` returned `enabled`.
- `systemctl show` confirmed `User=chroma`, `Group=chroma`, and
  `CAP_NET_BIND_SERVICE` in the ambient and bounding capability sets.
- `ss -ltnp` confirmed the Chroma process listening on `0.0.0.0:80` and
  `0.0.0.0:443`. There was no privileged-port binding failure.
- HTTPS `/health` returned 200, with production paths under `/opt/chroma`,
  `/etc/chroma`, `/var/lib/chroma`, and `/var/log/chroma`.
- The HTML page, referenced JavaScript, CSS, and logo returned 200 over the LAN.
- HTTP `/health?probe=1` returned 308 to the matching HTTPS URL, preserving the
  path and query string.
- `/api/setup/status` returned `setupRequired: true`; `/api/auth/session`
  returned `authenticated: false`; `/api/instances` returned 401; an unknown API
  route returned 404.
- The bundled Node.js runtime successfully loaded the bundled SQLite native
  module as `chroma`. Read-only `PRAGMA integrity_check` returned `ok`, and the
  users table contained zero users.
- The service started successfully after the manual recovery described below.

Observed permissions on both hosts:

| Path | Owner | Mode |
| --- | --- | --- |
| `/etc/chroma`, `/var/lib/chroma`, `/var/log/chroma` | `chroma:chroma` | `0750` |
| `/etc/chroma/chroma.env` | `root:chroma` | `0640` |
| `/etc/chroma/pki/private.key` | `chroma:chroma` | `0600` |
| `/etc/chroma/pki/certificate.pem` | `chroma:chroma` | `0644` |
| `/var/lib/chroma/chroma.sqlite` | `chroma:chroma` | `0644` |

Only certificate metadata and file permissions were inspected; private keys were
not read. Certificates contain the VM hostname and localhost SANs, but not the
LAN IP. HTTPS probes accepted the initial self-signed certificate explicitly.

## Confirmed installer defect: rerunning the installed version causes downtime

Reproduction on each VM after its successful fresh install:

```bash
sudo bash /tmp/chroma-install-validation-39b411e.sh \
  --version 0.1.0 \
  --release-base-url http://192.168.76.25:18080 \
  --yes
```

Observed sequence:

1. Download and checksum verification succeed.
2. The installer stops the working Chroma service.
3. It creates a database backup under `/var/lib/chroma/backups/installer`.
4. It discovers that `/opt/chroma/releases/0.1.0` already exists, refuses to
   overwrite it, and exits with status 1.
5. `systemctl is-active chroma.service` returns `inactive`.

The cause is the ordering in
[`install-chroma.sh`](../../install/ubuntu/install-chroma.sh): `main` calls
`stop_existing_service` before `install_release`, which performs the existing
release check. The exit cleanup does not restart the previous service.

**Priority fix:** validate and stage the archive, inspect its version, and decide
how to handle an already-installed version before stopping the service. An
identical reinstall should either be a successful no-op or fail while leaving
the current service running. Also review recovery for other failures after the
service is stopped; those failure cases were not exercised here.

Recovery performed on both VMs:

```bash
sudo systemctl start chroma.service
```

Both services were verified healthy afterward. The installer-created database
backups were retained. No application files were patched to recover service.

## Other improvements to consider

- **Release publication:** publish both OS archives, their checksum files, and
  the installer for each version. Then repeat the download test using the actual
  GitHub release URL. Neither archive was published during this test.
- **Progress output:** add clear messages for checksum verification, extraction,
  configuration, service startup, and health verification. OpenSSL key-generation
  progress currently dominates the successful installation output.
- **Certificate setup:** consider accepting the intended public hostname or IP
  when generating the initial certificate. The current hostname-only SANs do not
  cover the LAN IP URLs used in this test. A self-signed trust warning is expected
  independently of this hostname mismatch.
- **Bootstrap documentation:** show a download-to-file command and explain sudo
  and curl prerequisites. The targets already had curl, so the case where curl
  itself is missing was not exercised.

## Future UFW support — no firewall changes in this test

Neither VM had UFW installed, and no UFW rules were added. LAN connectivity passed
in that environment; behavior with an active restrictive UFW policy remains
untested.

For a future version, consider an explicit option to configure:

- Chroma's configured TCP ports, normally 80 for HTTP redirects and 443 for HTTPS.
- Each instance's configured Bedrock UDP ports, normally 19132 and 19133.
- Appropriate IPv4 and IPv6 rules, accounting for the host's UFW configuration.

Detect whether UFW is installed and active. Preserve existing policies and SSH
access, and do not silently enable the firewall. Handle changed instance ports
and shared rules carefully so deleting an instance does not remove another
instance's required access. This is a future design note, not an implemented
feature.

## Validation limits and cleanup

- Both release builds passed TypeScript compilation and the Vite web build.
  Lint is not configured; a separate `pnpm typecheck` was not rerun for this
  installer test.
- No full VM reboot, new-version upgrade, browser-rendering test, Bedrock
  installation/start, addon download, or initial administrator setup was
  performed. No provider API keys were requested or used.
- Both production services remain enabled, healthy, and awaiting initial setup.
- Only this report was added to the tracked repository. Test assets and HTTP
  probe evidence are under `.runtime/production-install-validation/`.
- The temporary LAN asset server was stopped, SSH sessions were closed, and
  cached sudo authentication was invalidated on both target VMs. Final LAN HTTP
  checks still passed after cleanup.
- A local `lxc list` invocation unexpectedly triggered Ubuntu's automatic LXD
  snap installation. This affected only the development host. The temporary
  Ubuntu 24.04 build container, network, and storage pool were removed after the
  build. Removing the LXD snap itself was denied because host sudo authentication
  was unavailable; the snap remains installed on the development host.

## Follow-up: version handling and runtime verification fix

The updated installer was tested later on 2026-09-12 using the same two VMs and
unchanged application archives. Its SHA-256 was
`75529defb18b0e487310da8d033a0d0fe0265575248082e61e2f82da3ba3c3bc`.
No source or build tools were copied to either target.

Implemented behavior compares the downloaded archive's version with the installed
release marker: install when absent, upgrade when the archive is newer, offer an
optional reinstall when equal, and reject downgrades before stopping service.
An explicit `--version` must match the archive. Version ordering handles numeric
components and prereleases rather than comparing strings alphabetically.

Live results on both VMs:

- Answering `n` to the same-version prompt returned success only after the existing
  service and HTTPS health check passed. The PID and current release stayed unchanged.
- Reinstallation succeeded using an interactive `y` on Ubuntu 24.04 and `--yes` on
  Ubuntu 26.04. Both runs returned exit status 0 and passed the final health check.
- The original `/opt/chroma/releases/0.1.0` directory was retained. The installer
  activated a new, unique directory for the reinstalled version.
- Each reinstall created a new database backup with a collision-resistant filename.
- Inode, size, and modification time of the environment file, private key,
  certificate, and database were unchanged after reinstallation. Private-key
  contents were not read.
- Both services remained enabled with no automatic restarts recorded. LAN checks
  for the UI and assets, health, initial setup, authentication boundary, missing API
  route, and HTTP-to-HTTPS redirect passed again.

Eighteen disposable fixture checks under `.runtime/installer-version-validation`
also passed. These exercised the actual installer flow with simulated systemd and
downloads: fresh install, upgrade, numeric and prerelease ordering, equal-version
reinstall, downgrade rejection, invalid versions, incomplete archive, requested
version mismatch, noninteractive reinstall refusal, dry-run, database-backup
failure, service-start failure, and health-check timeout. Failure cases confirmed
that service status, journal output, and diagnostic commands are emitted. A backup
failure before activation restarted the unchanged previous installation.

The upgrade and fault cases were simulated locally; no real newer application
release or intentionally broken systemd service was installed on the target VMs.
Automatic rollback after activation remains intentionally unsupported because a
new application version might already have migrated the database.

Validation commands included `bash -n install/ubuntu/install-chroma.sh`, the
installer's `--help`, `git diff --check`, the disposable fixture checker, and the
LAN HTTP checker. No automated test framework was added. TypeScript/build checks
were not repeated for this Bash/documentation change; lint remains unconfigured.
