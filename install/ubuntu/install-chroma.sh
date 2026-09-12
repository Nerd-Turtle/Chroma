#!/usr/bin/env bash
set -Eeuo pipefail

readonly CHROMA_USER="chroma"
readonly CHROMA_GROUP="chroma"
readonly CHROMA_ROOT="/opt/chroma"
readonly CHROMA_CONFIG_DIR="/etc/chroma"
readonly CHROMA_DATA_DIR="/var/lib/chroma"
readonly CHROMA_LOG_DIR="/var/log/chroma"
readonly CHROMA_RELEASES_DIR="${CHROMA_ROOT}/releases"
readonly CHROMA_SERVICE_NAME="chroma.service"
readonly CHROMA_REPOSITORY="Nerd-Turtle/Chroma"
ARCHIVE_NAME="chroma-ubuntu-26.04-amd64.tar.gz"
CHECKSUM_NAME="${ARCHIVE_NAME}.sha256"

requested_version="latest"
release_base_url=""
disable_version_check=false
dry_run=false
assume_yes=false
temporary_download_dir=""
temporary_release_dir=""

usage() {
  cat <<'EOF'
Usage: install-chroma.sh [options]

Install a prebuilt Chroma release on Ubuntu AMD64.

Options:
  --version VERSION          Install a specific release version, for example 1.0.0.
  --release-base-url URL     Override the release download base URL. Intended for local testing.
  --disable-version-check    Test another Ubuntu version using the 26.04 release archive.
  --dry-run                  Validate prerequisites and show the planned install without changing the host.
  --yes                      Do not ask for confirmation when replacing an existing install.
  -h, --help                 Show this help text.
EOF
}

log() {
  printf '%s\n' "[chroma-install] $*"
}

fail() {
  printf '%s\n' "[chroma-install] Error: $*" >&2
  exit 1
}

cleanup() {
  local exit_code=$?

  if [[ -n "${temporary_download_dir}" && -d "${temporary_download_dir}" ]]; then
    rm -rf -- "${temporary_download_dir}"
  fi

  if [[ -n "${temporary_release_dir}" && -d "${temporary_release_dir}" ]]; then
    rm -rf -- "${temporary_release_dir}"
  fi

  exit "${exit_code}"
}

run() {
  if [[ "${dry_run}" == true ]]; then
    printf '[chroma-install] Would run:'
    printf ' %q' "$@"
    printf '\n'
    return
  fi

  "$@"
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || fail "Run this installer as root, for example: curl ... | sudo bash"
}

parse_arguments() {
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --version)
        [[ "$#" -ge 2 ]] || fail "--version requires a value"
        requested_version="$2"
        shift 2
        ;;
      --release-base-url)
        [[ "$#" -ge 2 ]] || fail "--release-base-url requires a value"
        release_base_url="${2%/}"
        shift 2
        ;;
      --disable-version-check)
        disable_version_check=true
        shift
        ;;
      --dry-run)
        dry_run=true
        shift
        ;;
      --yes)
        assume_yes=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
  done

  if [[ "${requested_version}" != "latest" && ! "${requested_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
    fail "Version must be a semantic version such as 1.0.0, or 'latest'."
  fi
}

check_platform() {
  [[ -r /etc/os-release ]] || fail "Unable to identify the operating system."

  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || fail "Chroma supports Ubuntu hosts only."

  if [[ "${VERSION_ID:-}" == "24.04" || "${VERSION_ID:-}" == "26.04" ]]; then
    ARCHIVE_NAME="chroma-ubuntu-${VERSION_ID}-amd64.tar.gz"
    CHECKSUM_NAME="${ARCHIVE_NAME}.sha256"
  else
    if [[ "${disable_version_check}" == true ]]; then
      log "Warning: continuing on unsupported Ubuntu ${VERSION_ID:-unknown} because --disable-version-check was supplied."
    else
      fail "Chroma supports Ubuntu 24.04 and 26.04. Use --disable-version-check only for deliberate compatibility testing."
    fi
  fi

  [[ "$(dpkg --print-architecture)" == "amd64" ]] || fail "This release supports AMD64 hosts only."
  command -v systemctl >/dev/null 2>&1 || fail "systemd is required."
}

install_prerequisites() {
  local packages=(ca-certificates curl openssl tar gzip coreutils)
  local missing_packages=()
  local package_name

  for package_name in "${packages[@]}"; do
    if ! dpkg-query --show --showformat='${db:Status-Status}' "${package_name}" 2>/dev/null | grep -qx "installed"; then
      missing_packages+=("${package_name}")
    fi
  done

  if [[ "${#missing_packages[@]}" -eq 0 ]]; then
    return
  fi

  log "Installing required Ubuntu packages: ${missing_packages[*]}"
  run apt-get update
  run apt-get install --yes --no-install-recommends "${missing_packages[@]}"
}

resolve_release_base_url() {
  if [[ -n "${release_base_url}" ]]; then
    return
  fi

  if [[ "${requested_version}" == "latest" ]]; then
    release_base_url="https://github.com/${CHROMA_REPOSITORY}/releases/latest/download"
  else
    release_base_url="https://github.com/${CHROMA_REPOSITORY}/releases/download/v${requested_version}"
  fi
}

download_and_verify_release() {
  temporary_download_dir="$(mktemp -d)"
  local archive_path="${temporary_download_dir}/${ARCHIVE_NAME}"
  local checksum_path="${temporary_download_dir}/${CHECKSUM_NAME}"

  log "Downloading Chroma ${requested_version} from ${release_base_url}"
  run curl --fail --show-error --silent --location --proto '=https,http' --tlsv1.2 --output "${checksum_path}" "${release_base_url}/${CHECKSUM_NAME}"
  run curl --fail --show-error --silent --location --proto '=https,http' --tlsv1.2 --output "${archive_path}" "${release_base_url}/${ARCHIVE_NAME}"

  if [[ "${dry_run}" == true ]]; then
    return
  fi

  (
    cd "${temporary_download_dir}"
    sha256sum --check --status "${CHECKSUM_NAME}"
  ) || fail "The downloaded release archive did not match its published SHA-256 checksum."
}

archive_is_safe() {
  local archive_path="$1"
  tar --list --gzip --file "${archive_path}" | awk '
    $0 !~ /^chroma(\/|$)/ { exit 1 }
    $0 ~ /(^|\/)\.\.($|\/)/ { exit 1 }
  '
}

confirm_existing_install() {
  [[ -L "${CHROMA_ROOT}/current" || ! -e "${CHROMA_ROOT}/current" ]] || fail "${CHROMA_ROOT}/current exists but is not a release symlink. Refusing to replace it."

  if [[ ! -e "${CHROMA_ROOT}/current" || "${assume_yes}" == true ]]; then
    return
  fi

  printf 'An existing Chroma installation was found. Continue and create a database backup? [y/N] '
  local reply=""
  read -r reply
  [[ "${reply}" =~ ^[Yy]([Ee][Ss])?$ ]] || fail "Installation cancelled."
}

create_service_account_and_paths() {
  if ! getent group "${CHROMA_GROUP}" >/dev/null; then
    run groupadd --system "${CHROMA_GROUP}"
  fi

  if ! id "${CHROMA_USER}" >/dev/null 2>&1; then
    run useradd --system --gid "${CHROMA_GROUP}" --home-dir "${CHROMA_DATA_DIR}" --shell /usr/sbin/nologin "${CHROMA_USER}"
  fi

  run install -d -o root -g root -m 0755 "${CHROMA_ROOT}" "${CHROMA_RELEASES_DIR}"
  run install -d -o "${CHROMA_USER}" -g "${CHROMA_GROUP}" -m 0750 "${CHROMA_CONFIG_DIR}" "${CHROMA_DATA_DIR}" "${CHROMA_LOG_DIR}"
}

backup_database() {
  local database_path="${CHROMA_DATA_DIR}/chroma.sqlite"
  [[ -f "${database_path}" ]] || return 0

  local backup_dir="${CHROMA_DATA_DIR}/backups/installer"
  local backup_path="${backup_dir}/chroma.sqlite.$(date -u +%Y%m%dT%H%M%SZ).bak"
  log "Backing up the Chroma database to ${backup_path}"
  run install -d -o "${CHROMA_USER}" -g "${CHROMA_GROUP}" -m 0750 "${backup_dir}"
  run cp --preserve=mode,timestamps "${database_path}" "${backup_path}"
  run chown "${CHROMA_USER}:${CHROMA_GROUP}" "${backup_path}"
}

stop_existing_service() {
  if systemctl is-active --quiet "${CHROMA_SERVICE_NAME}"; then
    log "Stopping the existing Chroma service. Managed Bedrock servers will be stopped cleanly."
    run systemctl stop "${CHROMA_SERVICE_NAME}"
  fi
}

read_release_version() {
  local version_file="$1/release-version"
  [[ -f "${version_file}" ]] || fail "Release archive does not contain release-version."
  local release_version
  release_version="$(<"${version_file}")"
  [[ "${release_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || fail "Release archive contains an invalid version."
  printf '%s' "${release_version}"
}

install_release() {
  local archive_path="${temporary_download_dir}/${ARCHIVE_NAME}"

  if [[ "${dry_run}" == true ]]; then
    log "Would extract and activate the downloaded release under ${CHROMA_RELEASES_DIR}."
    return
  fi

  archive_is_safe "${archive_path}" || fail "Release archive has an unsafe layout."
  temporary_release_dir="$(mktemp -d "${CHROMA_RELEASES_DIR}/.install.XXXXXX")"
  tar --extract --gzip --file "${archive_path}" --directory "${temporary_release_dir}" --no-same-owner

  local extracted_release="${temporary_release_dir}/chroma"
  local release_version
  release_version="$(read_release_version "${extracted_release}")"
  local target_release="${CHROMA_RELEASES_DIR}/${release_version}"

  [[ -d "${extracted_release}/app/dist/server" ]] || fail "Release archive is missing the compiled server."
  [[ -d "${extracted_release}/app/web/dist" ]] || fail "Release archive is missing the compiled web UI."
  [[ -x "${extracted_release}/node/bin/node" ]] || fail "Release archive is missing the bundled Node runtime."
  [[ -f "${extracted_release}/systemd/chroma.service" ]] || fail "Release archive is missing the systemd unit."
  [[ -x "${extracted_release}/install/generate-self-signed-certificate.sh" ]] || fail "Release archive is missing the certificate helper."

  if [[ -e "${target_release}" ]]; then
    fail "Release ${release_version} is already installed at ${target_release}. Refusing to overwrite it."
  fi

  mv "${extracted_release}" "${target_release}"
  rmdir "${temporary_release_dir}"
  temporary_release_dir=""

  ln -s "${target_release}" "${CHROMA_ROOT}/.current.new"
  mv -Tf "${CHROMA_ROOT}/.current.new" "${CHROMA_ROOT}/current"
}

install_configuration_and_service() {
  if [[ "${dry_run}" == true ]]; then
    log "Would install ${CHROMA_CONFIG_DIR}/chroma.env and enable ${CHROMA_SERVICE_NAME}."
    return
  fi

  local environment_file="${CHROMA_CONFIG_DIR}/chroma.env"
  if [[ ! -e "${environment_file}" ]]; then
    umask 0077
    cat >"${environment_file}" <<'EOF'
NODE_ENV=production
CHROMA_APP_DIR=/opt/chroma/current/app
CHROMA_CONFIG_DIR=/etc/chroma
CHROMA_DATA_DIR=/var/lib/chroma
CHROMA_LOG_DIR=/var/log/chroma
CHROMA_HOST=0.0.0.0
CHROMA_PORT=443
CHROMA_TLS_ENABLED=true
CHROMA_HTTP_REDIRECT_ENABLED=true
CHROMA_HTTP_HOST=0.0.0.0
CHROMA_HTTP_PORT=80
CHROMA_WEB_DIST_DIR=/opt/chroma/current/app/web/dist
EOF
    chown root:"${CHROMA_GROUP}" "${environment_file}"
    chmod 0640 "${environment_file}"
  fi

  install -o root -g root -m 0644 "${CHROMA_ROOT}/current/systemd/chroma.service" "/etc/systemd/system/${CHROMA_SERVICE_NAME}"
  # Use env rather than shell assignment prefixes: CHROMA_USER is read-only in
  # this script, and Bash rejects an assignment to a read-only shell variable.
  env \
    "CHROMA_USER=${CHROMA_USER}" \
    "CHROMA_GROUP=${CHROMA_GROUP}" \
    "CHROMA_PKI_DIR=${CHROMA_CONFIG_DIR}/pki" \
    "${CHROMA_ROOT}/current/install/generate-self-signed-certificate.sh"
  systemctl daemon-reload
  systemctl enable "${CHROMA_SERVICE_NAME}"
  systemctl start "${CHROMA_SERVICE_NAME}"
}

verify_service() {
  if [[ "${dry_run}" == true ]]; then
    log "Would verify the service and https://127.0.0.1/health."
    return
  fi

  systemctl is-active --quiet "${CHROMA_SERVICE_NAME}" || {
    journalctl --unit "${CHROMA_SERVICE_NAME}" --no-pager -n 50 >&2 || true
    fail "The Chroma service did not start."
  }

  # systemd considers Node started before the HTTP listener is ready.  Give the
  # process up to one minute to initialise the database, TLS, and listeners.
  local attempt
  for attempt in {1..60}; do
    if curl --fail --silent --insecure --max-time 2 https://127.0.0.1/health >/dev/null 2>&1; then
      return
    fi

    if ! systemctl is-active --quiet "${CHROMA_SERVICE_NAME}"; then
      journalctl --unit "${CHROMA_SERVICE_NAME}" --no-pager -n 50 >&2 || true
      fail "The Chroma service stopped before it passed its local health check."
    fi

    sleep 1
  done

  journalctl --unit "${CHROMA_SERVICE_NAME}" --no-pager -n 50 >&2 || true
  fail "Chroma did not pass its local health check within one minute."
}

main() {
  trap cleanup EXIT
  parse_arguments "$@"
  require_root
  check_platform
  install_prerequisites
  resolve_release_base_url
  confirm_existing_install
  create_service_account_and_paths
  download_and_verify_release
  stop_existing_service
  backup_database
  install_release
  install_configuration_and_service
  verify_service
  log "Chroma installation complete. Open https://<this-host>/ in a browser."
  log "A self-signed certificate was created; replace it in Chroma Settings to remove the browser warning."
}

main "$@"
