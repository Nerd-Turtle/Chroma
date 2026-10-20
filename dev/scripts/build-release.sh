#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_ROOT="${REPO_ROOT}/release"
NODE_VERSION="${CHROMA_NODE_VERSION:-24.19.0}"
NODE_PLATFORM="linux-x64"
ARCHIVE_NAME="chroma-ubuntu-amd64.tar.gz"
PACKAGE_VERSION=""
OUTPUT_DIRECTORY=""

usage() {
  cat <<'EOF'
Usage: build-release.sh [options]

Build one self-contained Chroma archive for Ubuntu 24.04 and 26.04 AMD64.
Native libraries must remain compatible with the Ubuntu 24.04 baseline.

Options:
  --output DIRECTORY  Write release assets to DIRECTORY instead of release/<version>.
  -h, --help          Show this help text.

Environment:
  CHROMA_NODE_VERSION  Bundled Node.js version. Defaults to 24.19.0.
EOF
}

fail() {
  printf '%s\n' "[chroma-release] Error: $*" >&2
  exit 1
}

log() {
  printf '%s\n' "[chroma-release] $*"
}

cleanup() {
  local exit_code=$?
  if [[ -n "${stage_dir:-}" && -d "${stage_dir}" ]]; then
    rm -rf -- "${stage_dir}"
  fi
  exit "${exit_code}"
}

parse_arguments() {
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --output)
        [[ "$#" -ge 2 ]] || fail "--output requires a directory"
        OUTPUT_DIRECTORY="$2"
        shift 2
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
}

require_tools() {
  local required=(corepack curl readelf sha256sum tar)
  local tool
  for tool in "${required[@]}"; do
    command -v "${tool}" >/dev/null 2>&1 || fail "Required tool is missing: ${tool}"
  done
}

check_platform() {
  [[ -r /etc/os-release ]] || fail "Unable to identify the build operating system."
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == "ubuntu" && ( "${VERSION_ID:-}" == "24.04" || "${VERSION_ID:-}" == "26.04" ) ]] \
    || fail "Build releases on Ubuntu 24.04 or 26.04."
  [[ "$(uname -m)" == "x86_64" ]] || fail "Build releases on AMD64."
}

check_native_compatibility() {
  log "Checking bundled binaries against the Ubuntu 24.04 library baseline"
  node --input-type=module - "${bundle_dir}" <<'NODE'
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Baseline symbols exported by Ubuntu 24.04's libc6 and libstdc++6 packages.
const limits = { GLIBC: "2.39", GLIBCXX: "3.4.33", CXXABI: "1.3.15" };
const bundle = process.argv[2];
let checked = 0;
function check(binary) {
  const output = execFileSync("readelf", ["--version-info", "--wide", binary], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  for (const [, symbol, family, version] of output.matchAll(/\bName: ((GLIBC|GLIBCXX|CXXABI)_([^\s]+))/g)) {
    const required = version.split(".").map(Number);
    const maximum = limits[family].split(".").map(Number);
    let comparison = 0;
    for (let index = 0; index < Math.max(required.length, maximum.length) && comparison === 0; index++) {
      comparison = (required[index] ?? 0) - (maximum[index] ?? 0);
    }
    if (required.some((part) => !Number.isInteger(part)) || comparison > 0) {
      throw new Error(`${binary} requires ${symbol}, beyond the Ubuntu 24.04 baseline. Build with clean dependencies on Ubuntu 24.04.`);
    }
  }
  checked++;
}
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile() && /(?:\.node|\.so(?:\.[\d.]+)?)$/.test(entry.name)) check(path);
  }
}
check(join(bundle, "node/bin/node"));
visit(join(bundle, "app/node_modules"));
console.log(`[chroma-release] ${checked} bundled binaries passed library version checks.`);
NODE

  log "Checking SQLite with the bundled Node.js runtime"
  (
    cd "${bundle_dir}/app"
    "${bundle_dir}/node/bin/node" --input-type=module <<'NODE'
import assert from "node:assert/strict";
import Database from "better-sqlite3";
const database = new Database(":memory:");
try { assert.equal(database.prepare("SELECT 1 AS value").get().value, 1); }
finally { database.close(); }
NODE
  )
}

download_node_runtime() {
  local node_archive="node-v${NODE_VERSION}-${NODE_PLATFORM}.tar.xz"
  local node_base_url="https://nodejs.org/dist/v${NODE_VERSION}"
  local node_archive_path="${stage_dir}/${node_archive}"
  local checksum_file="${stage_dir}/SHASUMS256.txt"

  log "Downloading Node.js ${NODE_VERSION} for ${NODE_PLATFORM}"
  curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 --output "${checksum_file}" "${node_base_url}/SHASUMS256.txt"
  curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 --output "${node_archive_path}" "${node_base_url}/${node_archive}"
  (
    cd "${stage_dir}"
    grep " ${node_archive}$" SHASUMS256.txt | sha256sum --check --status -
  ) || fail "Node.js archive checksum verification failed."

  tar --extract --xz --file "${node_archive_path}" --directory "${bundle_dir}/node" --strip-components=1 --no-same-owner
}

main() {
  parse_arguments "$@"
  require_tools
  check_platform
  trap cleanup EXIT

  cd "${REPO_ROOT}"
  PACKAGE_VERSION="$(node --input-type=module -e 'import pkg from "./package.json" with { type: "json" }; process.stdout.write(pkg.version);')"
  [[ "${PACKAGE_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || fail "package.json has an invalid version."
  OUTPUT_DIRECTORY="${OUTPUT_DIRECTORY:-${RELEASE_ROOT}/${PACKAGE_VERSION}}"
  OUTPUT_DIRECTORY="$(realpath -m "${OUTPUT_DIRECTORY}")"

  [[ ! -e "${OUTPUT_DIRECTORY}/${ARCHIVE_NAME}" ]] || fail "${OUTPUT_DIRECTORY}/${ARCHIVE_NAME} already exists. Choose a different --output directory."

  mkdir -p "${OUTPUT_DIRECTORY}"
  stage_dir="$(mktemp -d "${OUTPUT_DIRECTORY}/.build.XXXXXX")"
  bundle_dir="${stage_dir}/chroma"
  deploy_dir="${stage_dir}/deploy"

  log "Installing the locked dependency graph"
  corepack pnpm install --frozen-lockfile
  log "Building the server and web UI"
  corepack pnpm build
  corepack pnpm build:web

  log "Creating production dependency bundle"
  corepack pnpm --filter chroma deploy --legacy --prod --config.public-hoist-pattern='*' "${deploy_dir}"

  mkdir -p "${bundle_dir}/app/dist" "${bundle_dir}/app/web" "${bundle_dir}/node" "${bundle_dir}/install" "${bundle_dir}/systemd"
  cp "${REPO_ROOT}/package.json" "${bundle_dir}/app/package.json"
  cp -a "${REPO_ROOT}/dist/server" "${bundle_dir}/app/dist/"
  cp -a "${REPO_ROOT}/src/web/dist" "${bundle_dir}/app/web/"
  cp -a "${deploy_dir}/node_modules" "${bundle_dir}/app/node_modules"
  cp "${REPO_ROOT}/install/ubuntu/generate-self-signed-certificate.sh" "${bundle_dir}/install/generate-self-signed-certificate.sh"
  cp "${REPO_ROOT}/install/ubuntu/install-chroma.sh" "${bundle_dir}/install/install-chroma.sh"
  cp "${REPO_ROOT}/install/ubuntu/chroma.service" "${bundle_dir}/systemd/chroma.service"
  cp "${REPO_ROOT}/install/ubuntu/chroma-update.socket" "${bundle_dir}/systemd/chroma-update.socket"
  cp "${REPO_ROOT}/install/ubuntu/chroma-update@.service" "${bundle_dir}/systemd/chroma-update@.service"
  printf '%s\n' "${PACKAGE_VERSION}" >"${bundle_dir}/release-version"
  git -C "${REPO_ROOT}" rev-parse HEAD >"${bundle_dir}/source-commit"

  download_node_runtime
  check_native_compatibility
  chmod 0755 "${bundle_dir}/install/generate-self-signed-certificate.sh"
  find "${bundle_dir}" -type d -exec chmod 0755 {} +
  find "${bundle_dir}" -type f -exec chmod 0644 {} +
  chmod 0755 "${bundle_dir}/node/bin/node" "${bundle_dir}/install/generate-self-signed-certificate.sh"

  log "Creating ${ARCHIVE_NAME}"
  tar --create --gzip --file "${OUTPUT_DIRECTORY}/${ARCHIVE_NAME}" --directory "${stage_dir}" chroma
  (
    cd "${OUTPUT_DIRECTORY}"
    sha256sum "${ARCHIVE_NAME}" >"${ARCHIVE_NAME}.sha256"
  )
  cp "${REPO_ROOT}/install/ubuntu/install-chroma.sh" "${OUTPUT_DIRECTORY}/install-chroma.sh"
  chmod 0755 "${OUTPUT_DIRECTORY}/install-chroma.sh"

  log "Release assets created in ${OUTPUT_DIRECTORY}"
}

main "$@"
