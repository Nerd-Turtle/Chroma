# Chroma Ubuntu installer assets

The v1 Ubuntu installer will run `generate-self-signed-certificate.sh` after it creates the
`chroma` service account. The helper creates one long-lived private key and an initial self-signed
server certificate. It is deliberately idempotent and will not overwrite an existing key or
certificate.

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
CHROMA_WEB_DIST_DIR=/opt/chroma/web/dist
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
