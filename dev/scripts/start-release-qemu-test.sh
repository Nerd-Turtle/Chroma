#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_DIRECTORY="${REPO_ROOT}/release/0.1.0"
UBUNTU_IMAGE=""
SSH_PORT=2222
HTTP_PORT=8080
VM_DIRECTORY=""

usage() {
  cat <<'EOF'
Usage: start-release-qemu-test.sh [options]

Start a disposable Ubuntu 26.04 AMD64 QEMU guest for testing a locally built Chroma release.
The guest reaches the release assets at http://10.0.2.2:<http-port>.

Options:
  --release-dir DIRECTORY  Directory containing install-chroma.sh and release assets.
  --ubuntu-image PATH      Verified Ubuntu 26.04 cloud image to boot.
  --ssh-port PORT          Host port forwarded to guest SSH. Defaults to 2222.
  --http-port PORT         Host port serving release assets. Defaults to 8080.
  --vm-dir DIRECTORY       Directory for temporary guest files. Defaults to a new /tmp directory.
  -h, --help               Show this help text.
EOF
}

fail() {
  printf '%s\n' "[chroma-qemu] Error: $*" >&2
  exit 1
}

parse_arguments() {
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --release-dir)
        [[ "$#" -ge 2 ]] || fail "--release-dir requires a directory"
        RELEASE_DIRECTORY="$2"
        shift 2
        ;;
      --ubuntu-image)
        [[ "$#" -ge 2 ]] || fail "--ubuntu-image requires a path"
        UBUNTU_IMAGE="$2"
        shift 2
        ;;
      --ssh-port)
        [[ "$#" -ge 2 ]] || fail "--ssh-port requires a port"
        SSH_PORT="$2"
        shift 2
        ;;
      --http-port)
        [[ "$#" -ge 2 ]] || fail "--http-port requires a port"
        HTTP_PORT="$2"
        shift 2
        ;;
      --vm-dir)
        [[ "$#" -ge 2 ]] || fail "--vm-dir requires a directory"
        VM_DIRECTORY="$2"
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
  local tool
  for tool in cloud-localds python3 qemu-img qemu-system-x86_64 ssh-keygen; do
    command -v "${tool}" >/dev/null 2>&1 || fail "Required tool is missing: ${tool}"
  done
}

main() {
  parse_arguments "$@"
  require_tools

  RELEASE_DIRECTORY="$(realpath "${RELEASE_DIRECTORY}")"
  [[ -f "${RELEASE_DIRECTORY}/install-chroma.sh" ]] || fail "Release installer not found. Build the release first."
  [[ -f "${RELEASE_DIRECTORY}/chroma-ubuntu-26.04-amd64.tar.gz" ]] || fail "Release archive not found."
  [[ -f "${RELEASE_DIRECTORY}/chroma-ubuntu-26.04-amd64.tar.gz.sha256" ]] || fail "Release checksum not found."
  [[ -n "${UBUNTU_IMAGE}" ]] || fail "Pass a verified Ubuntu 26.04 cloud image with --ubuntu-image."
  UBUNTU_IMAGE="$(realpath "${UBUNTU_IMAGE}")"
  [[ -f "${UBUNTU_IMAGE}" ]] || fail "Ubuntu cloud image not found."

  VM_DIRECTORY="${VM_DIRECTORY:-$(mktemp -d /tmp/chroma-qemu-test.XXXXXX)}"
  mkdir -p "${VM_DIRECTORY}"
  [[ -z "$(find "${VM_DIRECTORY}" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail "VM directory must be empty: ${VM_DIRECTORY}"

  ssh-keygen -q -t ed25519 -N "" -f "${VM_DIRECTORY}/id_ed25519"
  local public_key
  public_key="$(<"${VM_DIRECTORY}/id_ed25519.pub")"
  cat >"${VM_DIRECTORY}/user-data" <<EOF
#cloud-config
users:
  - name: chroma-test
    groups: [sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ${public_key}
ssh_pwauth: false
disable_root: true
EOF
  cat >"${VM_DIRECTORY}/meta-data" <<'EOF'
instance-id: chroma-release-test
local-hostname: chroma-release-test
EOF
  cloud-localds "${VM_DIRECTORY}/seed.iso" "${VM_DIRECTORY}/user-data" "${VM_DIRECTORY}/meta-data"

  qemu-img create -q -f qcow2 -F qcow2 -b "${UBUNTU_IMAGE}" "${VM_DIRECTORY}/disk.qcow2"
  qemu-img resize -q "${VM_DIRECTORY}/disk.qcow2" 10G

  setsid python3 -m http.server "${HTTP_PORT}" --bind 0.0.0.0 --directory "${RELEASE_DIRECTORY}" >"${VM_DIRECTORY}/http.log" 2>&1 < /dev/null &
  local http_pid=$!
  qemu-system-x86_64 \
    -machine q35 \
    -accel tcg,thread=multi \
    -cpu max \
    -smp 2 \
    -m 2048 \
    -drive "file=${VM_DIRECTORY}/disk.qcow2,if=virtio,format=qcow2" \
    -drive "file=${VM_DIRECTORY}/seed.iso,media=cdrom,readonly=on" \
    -nic "user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:${SSH_PORT}-:22,hostfwd=tcp:127.0.0.1:8081-:80,hostfwd=tcp:127.0.0.1:8443-:443" \
    -display none \
    -serial "file:${VM_DIRECTORY}/serial.log" \
    -daemonize \
    -pidfile "${VM_DIRECTORY}/qemu.pid"

  printf '%s\n' "${http_pid}" >"${VM_DIRECTORY}/http.pid"
  printf '%s\n' "${VM_DIRECTORY}" >"${VM_DIRECTORY}/README"
  printf '%s\n' "QEMU guest started."
  printf 'VM files: %s\n' "${VM_DIRECTORY}"
  printf 'SSH: ssh -i %q -p %q -o StrictHostKeyChecking=accept-new chroma-test@127.0.0.1\n' "${VM_DIRECTORY}/id_ed25519" "${SSH_PORT}"
  printf 'Chroma: https://127.0.0.1:8443/ after installation\n'
  printf 'Installer: sudo bash /tmp/install-chroma.sh --version 0.1.0 --release-base-url http://10.0.2.2:%s --yes\n' "${HTTP_PORT}"
  printf 'Cleanup: kill $(cat %q) $(cat %q); move %q to a temporary location when finished.\n' "${VM_DIRECTORY}/qemu.pid" "${VM_DIRECTORY}/http.pid" "${VM_DIRECTORY}"
}

main "$@"
