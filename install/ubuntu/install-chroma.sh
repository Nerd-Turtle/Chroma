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
readonly ARCHIVE_NAME="chroma-ubuntu-amd64.tar.gz"
readonly CHECKSUM_NAME="${ARCHIVE_NAME}.sha256"

requested_version="latest"
release_base_url=""
disable_version_check=false
dry_run=false
assume_yes=false
temporary_download_dir=""
temporary_release_dir=""
installed_version=""
release_version=""
install_action="install"
previous_service_running=false
service_changes_started=false
release_activated=false
diagnostics_shown=false

usage() {
  cat <<'EOF'
Usage: install-chroma.sh [options]

Install a prebuilt Chroma release on Ubuntu AMD64.

Options:
  --version VERSION          Install a specific version. Defaults to the latest stable release.
  --release-base-url URL     Override the release download base URL. Intended for local testing.
  --disable-version-check    Allow deliberate compatibility testing on another Ubuntu version.
  --dry-run                  Validate prerequisites and show the planned install without changing the host.
  --yes                      Accept reinstalling an already-installed version without prompting.
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

  if [[ "${exit_code}" -ne 0 && "${service_changes_started}" == true ]]; then
    show_service_diagnostics
    # Before activation the old application and unit are still intact. After
    # activation, automatic rollback could conflict with database migrations.
    if [[ "${previous_service_running}" == true && "${release_activated}" == false ]]; then
      log "Attempting to restart the unchanged previous installation."
      systemctl start "${CHROMA_SERVICE_NAME}" || true
    fi
  fi

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

  if [[ "${VERSION_ID:-}" != "24.04" && "${VERSION_ID:-}" != "26.04" ]]; then
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
  local packages=(ca-certificates curl openssl tar gzip coreutils util-linux libstdc++6)
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

detect_existing_install() {
  local current="${CHROMA_ROOT}/current"
  if [[ ! -e "${current}" && ! -L "${current}" ]]; then
    log "No existing Chroma installation found."
    return
  fi

  [[ -L "${current}" && -d "${current}" ]] || fail "${current} is not a valid release symlink. Refusing to replace it."
  local resolved_current
  resolved_current="$(readlink -f "${current}")"
  [[ "${resolved_current}" == "${CHROMA_RELEASES_DIR}/"* ]] || fail "Current release is outside ${CHROMA_RELEASES_DIR}."
  installed_version="$(read_release_version "${current}")"
  log "Installed Chroma version: ${installed_version}"
}

compare_release_versions() {
  # Use the bundled runtime so the target host needs no system Node.js. Compare
  # SemVer components numerically and prerelease identifiers by SemVer rules.
  "${temporary_release_dir}/chroma/node/bin/node" --input-type=module - "${release_version}" "${installed_version:-${release_version}}" <<'JS'
const parse = (version) => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);
  const pre = match[4]?.split(".") ?? [];
  if (pre.some(part => /^0\d+$/.test(part))) throw new Error(`Invalid prerelease version: ${version}`);
  return { core: match.slice(1, 4).map(BigInt), pre };
};
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const left = parse(process.argv[2]);
const right = parse(process.argv[3]);
let result = 0;
for (let i = 0; i < 3 && result === 0; i++) result = compare(left.core[i], right.core[i]);
if (result === 0 && (left.pre.length === 0 || right.pre.length === 0)) {
  result = compare(Number(left.pre.length === 0), Number(right.pre.length === 0));
} else if (result === 0) {
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length) && result === 0; i++) {
    const a = left.pre[i], b = right.pre[i];
    if (a === undefined || b === undefined) result = a === undefined ? -1 : 1;
    else if (/^\d+$/.test(a) && /^\d+$/.test(b)) result = compare(BigInt(a), BigInt(b));
    else if (/^\d+$/.test(a) !== /^\d+$/.test(b)) result = /^\d+$/.test(a) ? -1 : 1;
    else result = compare(a, b);
  }
}
console.log(result);
JS
}

choose_install_action() {
  local comparison
  comparison="$(compare_release_versions)" || fail "Unable to compare release versions using the bundled Node.js runtime."
  if [[ -z "${installed_version}" ]]; then
    install_action="install"
  elif [[ "${comparison}" == "1" ]]; then
    install_action="upgrade"
  elif [[ "${comparison}" == "-1" ]]; then
    fail "Downgrade refused: installed Chroma ${installed_version} is newer than release ${release_version}. The existing installation has not been stopped."
  else
    install_action="reinstall"
    if [[ "${assume_yes}" != true ]]; then
      printf 'Chroma %s is already installed. Reinstall application files and preserve configuration and data? [y/N] ' "${installed_version}"
      local reply=""
      if ! { read -r reply </dev/tty; } 2>/dev/null; then
        fail "Reinstall requires an interactive terminal, or --yes to explicitly accept it."
      fi
      if [[ ! "${reply}" =~ ^[Yy]([Ee][Ss])?$ ]]; then
        install_action="keep"
        log "Keeping the existing installation."
      fi
    fi
  fi
  log "Selected action: ${install_action} (release ${release_version})"
}

create_service_account_and_paths() {
  if ! getent group "${CHROMA_GROUP}" >/dev/null; then
    run groupadd --system "${CHROMA_GROUP}"
  fi

  if ! id "${CHROMA_USER}" >/dev/null 2>&1; then
    run useradd --system --gid "${CHROMA_GROUP}" --home-dir "${CHROMA_DATA_DIR}" --shell /usr/sbin/nologin "${CHROMA_USER}"
  fi

  run install -d -o root -g root -m 0755 "${CHROMA_ROOT}" "${CHROMA_RELEASES_DIR}"
  run install -d -o root -g root -m 0755 "${CHROMA_ROOT}/update-state"
  run install -d -o "${CHROMA_USER}" -g "${CHROMA_GROUP}" -m 0750 "${CHROMA_CONFIG_DIR}" "${CHROMA_DATA_DIR}" "${CHROMA_LOG_DIR}"
}

backup_database() {
  local database_path="${CHROMA_DATA_DIR}/chroma.sqlite"
  [[ -f "${database_path}" ]] || return 0

  local backup_dir="${CHROMA_DATA_DIR}/backups/installer"
  run install -d -o "${CHROMA_USER}" -g "${CHROMA_GROUP}" -m 0750 "${backup_dir}"
  local backup_path
  backup_path="$(mktemp "${backup_dir}/chroma.sqlite.$(date -u +%Y%m%dT%H%M%SZ).XXXXXX.bak")"
  log "Backing up the Chroma database to ${backup_path}"
  run cp --preserve=mode,timestamps "${database_path}" "${backup_path}"
  run chown "${CHROMA_USER}:${CHROMA_GROUP}" "${backup_path}"
}

stop_existing_service() {
  service_changes_started=true
  if systemctl is-active --quiet "${CHROMA_SERVICE_NAME}"; then
    previous_service_running=true
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

stage_release() {
  local archive_path="${temporary_download_dir}/${ARCHIVE_NAME}"
  archive_is_safe "${archive_path}" || fail "Release archive has an unsafe layout."
  temporary_release_dir="$(mktemp -d "${temporary_download_dir}/extracted.XXXXXX")"
  tar --extract --gzip --file "${archive_path}" --directory "${temporary_release_dir}" --no-same-owner

  local extracted_release="${temporary_release_dir}/chroma"
  release_version="$(read_release_version "${extracted_release}")"
  if [[ "${requested_version}" != "latest" && "${requested_version}" != "${release_version}" ]]; then
    fail "Requested release ${requested_version}, but the archive contains ${release_version}."
  fi

  [[ -d "${extracted_release}/app/dist/server" ]] || fail "Release archive is missing the compiled server."
  [[ -d "${extracted_release}/app/web/dist" ]] || fail "Release archive is missing the compiled web UI."
  [[ -x "${extracted_release}/node/bin/node" ]] || fail "Release archive is missing the bundled Node runtime."
  [[ -f "${extracted_release}/systemd/chroma.service" ]] || fail "Release archive is missing the systemd unit."
  [[ -x "${extracted_release}/install/generate-self-signed-certificate.sh" ]] || fail "Release archive is missing the certificate helper."
  log "Validated release ${release_version}."
}

install_release() {
  # Each activation has its own directory, including same-version reinstalls.
  # Copy before stopping so disk-space or copy errors leave Chroma running.
  local target_release
  target_release="$(mktemp -d "${CHROMA_RELEASES_DIR}/${release_version}.XXXXXX")"
  cp -a "${temporary_release_dir}/chroma/." "${target_release}/"
  chmod 0755 "${target_release}"

  stop_existing_service
  backup_database
  local activation_directory
  activation_directory="$(mktemp -d "${CHROMA_ROOT}/.activate.XXXXXX")"
  ln -s "${target_release}" "${activation_directory}/current"
  mv -Tf "${activation_directory}/current" "${CHROMA_ROOT}/current"
  release_activated=true
  rmdir "${activation_directory}"
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
  if [[ -f "${CHROMA_ROOT}/current/systemd/chroma-update.socket" &&
        -f "${CHROMA_ROOT}/current/systemd/chroma-update@.service" &&
        -f "${CHROMA_ROOT}/current/install/install-chroma.sh" &&
        -f "${CHROMA_ROOT}/current/app/dist/server/updates/updateWorker.js" ]]; then
    install -o root -g root -m 0644 "${CHROMA_ROOT}/current/systemd/chroma-update.socket" /etc/systemd/system/chroma-update.socket
    install -o root -g root -m 0644 "${CHROMA_ROOT}/current/systemd/chroma-update@.service" /etc/systemd/system/chroma-update@.service
  fi
  # Use env rather than shell assignment prefixes: CHROMA_USER is read-only in
  # this script, and Bash rejects an assignment to a read-only shell variable.
  env \
    "CHROMA_USER=${CHROMA_USER}" \
    "CHROMA_GROUP=${CHROMA_GROUP}" \
    "CHROMA_PKI_DIR=${CHROMA_CONFIG_DIR}/pki" \
    "${CHROMA_ROOT}/current/install/generate-self-signed-certificate.sh"
  systemctl daemon-reload
  if [[ -f "${CHROMA_ROOT}/current/systemd/chroma-update.socket" ]]; then
    systemctl enable --now chroma-update.socket
  fi
  systemctl enable "${CHROMA_SERVICE_NAME}"
  systemctl start "${CHROMA_SERVICE_NAME}"
}

show_service_diagnostics() {
  if [[ "${diagnostics_shown}" == true ]]; then
    return
  fi
  diagnostics_shown=true
  systemctl status "${CHROMA_SERVICE_NAME}" --no-pager --full >&2 || true
  journalctl --unit "${CHROMA_SERVICE_NAME}" --no-pager -n 50 >&2 || true
  printf 'Inspect with: sudo systemctl status %s --no-pager --full\n' "${CHROMA_SERVICE_NAME}" >&2
  printf '             sudo journalctl -u %s --no-pager -n 50\n' "${CHROMA_SERVICE_NAME}" >&2
}

verify_service() {
  if [[ "${dry_run}" == true ]]; then
    log "Would verify the service and https://127.0.0.1/health."
    return
  fi

  systemctl is-active --quiet "${CHROMA_SERVICE_NAME}" || {
    show_service_diagnostics
    fail "The Chroma service did not start."
  }

  # systemd considers Node started before the HTTP listener is ready.  Give the
  # process up to one minute to initialise the database, TLS, and listeners.
  local attempt
  for attempt in {1..60}; do
    if curl --fail --silent --insecure --max-time 2 https://127.0.0.1/health >/dev/null 2>&1 &&
       systemctl is-active --quiet "${CHROMA_SERVICE_NAME}"; then
      log "Chroma service is running and its HTTPS health check passed."
      return
    fi

    if ! systemctl is-active --quiet "${CHROMA_SERVICE_NAME}"; then
      show_service_diagnostics
      fail "The Chroma service stopped before it passed its local health check."
    fi

    sleep 1
  done

  show_service_diagnostics
  fail "Chroma did not pass its local health check within one minute."
}

main() {
  trap cleanup EXIT
  parse_arguments "$@"
  require_root
  check_platform
  detect_existing_install
  resolve_release_base_url
  if [[ "${dry_run}" == true ]]; then
    log "Would download and validate release ${requested_version} from ${release_base_url}."
    log "Would compare archive and installed versions: install, upgrade, prompt to reinstall, or reject downgrade."
    log "No changes made; the exact action requires downloading the archive."
    verify_service
    return
  fi
  install_prerequisites
  # The WebUI helper and command-line installs share this lock.
  install -d -o root -g root -m 0755 "${CHROMA_ROOT}" "${CHROMA_ROOT}/update-state"
  exec {installer_lock_fd}>"${CHROMA_ROOT}/update-state/installer.lock"
  flock --nonblock "${installer_lock_fd}" || fail "Another Chroma installer is already running."
  download_and_verify_release
  stage_release
  choose_install_action
  if [[ "${install_action}" == "keep" ]]; then
    verify_service
    return
  fi
  create_service_account_and_paths
  install_release
  install_configuration_and_service
  verify_service
  log "Chroma ${install_action} complete (${release_version}). Open https://<this-host>/ in a browser."
  log "Manage the HTTPS certificate in Chroma Settings."
}

main "$@"
