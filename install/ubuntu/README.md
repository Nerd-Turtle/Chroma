# Chroma Ubuntu installer assets

The installer is intended to download a prebuilt release archive; it must never clone the Chroma
repository or compile application code on the target host. Chroma supports Ubuntu 24.04 and 26.04 AMD64.
`install-chroma.sh --disable-version-check` exists only for deliberate compatibility testing on a
different Ubuntu version, using the 26.04 archive.

Build local release assets with:

```bash
pnpm build:release
```

This creates `release/<package-version>/` containing the application archive, SHA-256 checksum,
and installer script. The archive includes the compiled server, compiled web UI, production
dependencies, and the pinned Node.js runtime. The target host therefore does not need Node.js,
pnpm, Git, or a compiler.

Build once on Ubuntu 24.04 AMD64 and once on Ubuntu 26.04 AMD64 with clean dependencies on
each host. Native dependencies such as SQLite are bundled from that host. The builder names
the archives `chroma-ubuntu-24.04-amd64.tar.gz` and `chroma-ubuntu-26.04-amd64.tar.gz`;
publish both archives and their checksums with the installer. The installer selects the archive
matching the target host. Validate each archive using a matching cloud image with
`dev/scripts/start-release-qemu-test.sh`.

The v1 Ubuntu installer will run `generate-self-signed-certificate.sh` after it creates the
`chroma` service account. The helper creates one long-lived private key and an initial self-signed
server certificate. It is deliberately idempotent and will not overwrite an existing key or
certificate.

## Install, upgrade, and reinstall behavior

The installer compares the version inside the verified release archive with the version
recorded by `/opt/chroma/current/release-version`:

| Existing installation | Archive version | Action |
| --- | --- | --- |
| None | Any supported version | Install |
| Present | Newer than installed | Upgrade |
| Present | Equal to installed | Prompt to reinstall; default is No |
| Present | Older than installed | Reject the downgrade before stopping Chroma |

`--yes` accepts a same-version reinstall without prompting. Interactive prompts read from
`/dev/tty`, so they also work when the installer itself is piped into Bash. Without a terminal,
a same-version reinstall requires `--yes`. Declining a reinstall keeps the existing release
and still checks its service and HTTPS health before returning success.

The archive is validated and copied before the service stops. Each activation uses a unique
`/opt/chroma/releases/<version>.<suffix>` directory; previous release directories are retained.
The installer backs up the database while Chroma is stopped, switches `current`, and preserves
existing configuration, certificates, worlds, and addon data. Backup names include a random
suffix to avoid overwriting another backup made within the same second.

Success requires both an active systemd service and a successful local HTTPS health check.
Service failures print `systemctl status`, recent `journalctl` output, and commands for further
inspection. If a failure occurs after stopping but before switching releases, the installer
attempts to restart the unchanged previous installation. It does not automatically roll back
after activation because the new application may already have migrated the database.

`--dry-run` reports the planned steps without downloading an archive, prompting, or changing
the host. The exact version decision requires an actual archive download.

## Production HTTPS contract

The installer should set these environment values for the systemd service:

```ini
NODE_ENV=production
CHROMA_HOST=0.0.0.0
CHROMA_PORT=443
CHROMA_TLS_ENABLED=true
CHROMA_HTTP_REDIRECT_ENABLED=true
CHROMA_HTTP_HOST=0.0.0.0
CHROMA_HTTP_PORT=80
CHROMA_WEB_DIST_DIR=/opt/chroma/current/app/web/dist
```

Certificate files live under `/etc/chroma/pki`:

- `private.key`: application-owned mode `0600`; never returned by the API.
- `certificate.pem`: the leaf server certificate followed by intermediate certificates.
- `request.csr`: the latest CSR generated in Settings.
- `backups/`: prior certificates retained before a replacement is activated.

The service needs permission to bind ports 80 and 443. The systemd unit should grant only
`CAP_NET_BIND_SERVICE`; Chroma should continue to run as its unprivileged service account.

The Settings page reuses `private.key` when it generates a CSR. Uploading the signed PEM validates
the private-key match, certificate type, and validity dates before an atomic replacement. When TLS
is active, Fastify reloads the TLS context for new connections without a process restart.
