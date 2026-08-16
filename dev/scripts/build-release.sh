#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_ROOT="${REPO_ROOT}/release"
NODE_VERSION="${CHROMA_NODE_VERSION:-24.19.0}"
NODE_PLATFORM="linux-x64"
ARCHIVE_NAME="chroma-ubuntu-26.04-amd64.tar.gz"
PACKAGE_VERSION=""
OUTPUT_DIRECTORY=""

usage() {
  cat <<'EOF'
Usage: build-release.sh [options]

Build a self-contained Ubuntu 26.04 AMD64 Chroma release archive locally.

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
  local required=(corepack curl sha256sum tar)
  local tool
  for tool in "${required[@]}"; do
    command -v "${tool}" >/dev/null 2>&1 || fail "Required tool is missing: ${tool}"
  done
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
  cp "${REPO_ROOT}/install/ubuntu/chroma.service" "${bundle_dir}/systemd/chroma.service"
  printf '%s\n' "${PACKAGE_VERSION}" >"${bundle_dir}/release-version"
  git -C "${REPO_ROOT}" rev-parse HEAD >"${bundle_dir}/source-commit"

  download_node_runtime
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
