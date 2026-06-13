#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_ROOT="${REPO_ROOT}/.runtime"
RUNTIME_APP_DIR="${RUNTIME_ROOT}/opt/chroma"
RUNTIME_CONFIG_DIR="${RUNTIME_ROOT}/etc/chroma"
RUNTIME_DATA_DIR="${RUNTIME_ROOT}/var/lib/chroma"
RUNTIME_LOG_DIR="${RUNTIME_ROOT}/var/log/chroma"
RUNTIME_WEB_DIR="${RUNTIME_APP_DIR}/web"
RUNTIME_WEB_DIST_DIR="${RUNTIME_WEB_DIR}/dist"

ENV_FILE="${RUNTIME_CONFIG_DIR}/dev-built.env"
API_PID_FILE="${RUNTIME_DATA_DIR}/dev-built-api.pid"
WEB_PID_FILE="${RUNTIME_DATA_DIR}/dev-built-web.pid"
API_LOG_FILE="${RUNTIME_LOG_DIR}/dev-built-api.log"
WEB_LOG_FILE="${RUNTIME_LOG_DIR}/dev-built-web.log"
LEGACY_PID_FILE="${RUNTIME_DATA_DIR}/dev-built-server.pid"
LEGACY_LOG_FILE="${RUNTIME_LOG_DIR}/dev-built-server.log"

API_HOST="127.0.0.1"
API_PORT="3000"
WEB_HOST="127.0.0.1"
WEB_PORT="4173"

usage() {
  cat <<'EOF'
Usage:
  ./dev/dev-run.sh
  ./dev/dev-run.sh -start
  ./dev/dev-run.sh -build
  ./dev/dev-run.sh -stop
  ./dev/dev-run.sh -reset

Commands:
  -start  Start the staged API and web UI. Build first if the runtime build is missing.
  -build  Stop, rebuild from src, restage into .runtime, and start.
  -stop   Stop the running compiled API and web UI.
  -reset  Stop both processes and remove the .runtime SQLite database files.
EOF
}

require_tools() {
  local missing=()

  command -v node >/dev/null 2>&1 || missing+=("node")
  command -v pnpm >/dev/null 2>&1 || missing+=("pnpm")
  command -v curl >/dev/null 2>&1 || missing+=("curl")
  command -v setsid >/dev/null 2>&1 || missing+=("setsid")
  command -v cp >/dev/null 2>&1 || missing+=("cp")
  command -v ln >/dev/null 2>&1 || missing+=("ln")

  if ((${#missing[@]} > 0)); then
    printf 'Missing required tools: %s\n' "${missing[*]}" >&2
    exit 1
  fi
}

ensure_runtime_paths() {
  mkdir -p \
    "${RUNTIME_APP_DIR}" \
    "${RUNTIME_CONFIG_DIR}" \
    "${RUNTIME_DATA_DIR}" \
    "${RUNTIME_LOG_DIR}" \
    "${RUNTIME_WEB_DIR}"

  chmod 755 \
    "${RUNTIME_ROOT}" \
    "${RUNTIME_ROOT}/opt" \
    "${RUNTIME_ROOT}/etc" \
    "${RUNTIME_ROOT}/var" \
    "${RUNTIME_ROOT}/var/lib" \
    "${RUNTIME_ROOT}/var/log" \
    "${RUNTIME_APP_DIR}" \
    "${RUNTIME_CONFIG_DIR}" \
    "${RUNTIME_DATA_DIR}" \
    "${RUNTIME_LOG_DIR}" \
    "${RUNTIME_WEB_DIR}"
}

cleanup_legacy_files() {
  rm -f "${LEGACY_PID_FILE}" "${LEGACY_LOG_FILE}"
}

runtime_build_exists() {
  [[ -f "${RUNTIME_APP_DIR}/dist/server/index.js" && -f "${RUNTIME_WEB_DIST_DIR}/index.html" ]]
}

write_env_file() {
  cat >"${ENV_FILE}" <<EOF
NODE_ENV=production
CHROMA_HOST=${API_HOST}
CHROMA_PORT=${API_PORT}
CHROMA_APP_DIR=${RUNTIME_APP_DIR}
CHROMA_CONFIG_DIR=${RUNTIME_CONFIG_DIR}
CHROMA_DATA_DIR=${RUNTIME_DATA_DIR}
CHROMA_LOG_DIR=${RUNTIME_LOG_DIR}
CHROMA_WEB_DIST_DIR=${RUNTIME_WEB_DIST_DIR}
CHROMA_WEB_HOST=${WEB_HOST}
CHROMA_WEB_PORT=${WEB_PORT}
EOF

  chmod 644 "${ENV_FILE}"
}

build_application() {
  echo "Installing dependencies if needed..."
  (cd "${REPO_ROOT}" && pnpm install)

  echo "Building compiled server..."
  (cd "${REPO_ROOT}" && pnpm build)

  echo "Building compiled web UI..."
  (
    cd "${REPO_ROOT}"
    CHROMA_WEB_DIST_DIR="${RUNTIME_WEB_DIST_DIR}" pnpm build:web
  )
}

stage_application_files() {
  echo "Staging application files into ${RUNTIME_APP_DIR}..."

  rm -rf "${RUNTIME_APP_DIR}/dist"
  mkdir -p "${RUNTIME_APP_DIR}/dist"
  cp -R "${REPO_ROOT}/dist/." "${RUNTIME_APP_DIR}/dist/"

  ln -sfn "${REPO_ROOT}/node_modules" "${RUNTIME_APP_DIR}/node_modules"
  cp "${REPO_ROOT}/package.json" "${RUNTIME_APP_DIR}/package.json"

  chmod 755 "${RUNTIME_APP_DIR}" "${RUNTIME_APP_DIR}/dist" "${RUNTIME_WEB_DIR}" "${RUNTIME_WEB_DIST_DIR}"
  chmod 644 "${RUNTIME_APP_DIR}/package.json"
}

is_pid_running() {
  local pid="$1"
  kill -0 "${pid}" 2>/dev/null
}

read_pid() {
  local pid_file="$1"

  if [[ -f "${pid_file}" ]]; then
    tr -d '[:space:]' <"${pid_file}"
  fi
}

cleanup_stale_pid() {
  local pid_file="$1"
  local pid
  pid="$(read_pid "${pid_file}")"

  if [[ -n "${pid}" && ! "${pid}" =~ ^[0-9]+$ ]]; then
    rm -f "${pid_file}"
    return
  fi

  if [[ -n "${pid}" ]] && ! is_pid_running "${pid}"; then
    rm -f "${pid_file}"
  fi
}

stop_process() {
  local label="$1"
  local pid_file="$2"

  cleanup_stale_pid "${pid_file}"

  local pid
  pid="$(read_pid "${pid_file}")"

  if [[ -z "${pid}" ]]; then
    echo "No dev-built ${label} is running."
    return
  fi

  echo "Stopping dev-built ${label} (PID ${pid})..."
  kill "${pid}" 2>/dev/null || true

  for _ in {1..30}; do
    if ! is_pid_running "${pid}"; then
      rm -f "${pid_file}"
      echo "${label^} stopped."
      return
    fi

    sleep 1
  done

  echo "${label^} did not stop gracefully; sending SIGKILL."
  kill -9 "${pid}" 2>/dev/null || true
  rm -f "${pid_file}"
  echo "${label^} stopped."
}

wait_for_api_health() {
  local health_url="http://${API_HOST}:${API_PORT}/health"
  local pid

  for _ in {1..30}; do
    pid="$(read_pid "${API_PID_FILE}")"

    if [[ -z "${pid}" ]] || ! is_pid_running "${pid}"; then
      sleep 1
      continue
    fi

    if curl --silent --show-error --fail "${health_url}" >/dev/null; then
      if ! is_pid_running "${pid}"; then
        echo "The API responded once but did not stay running. Recent log output:" >&2
        tail -n 40 "${API_LOG_FILE}" >&2 || true
        rm -f "${API_PID_FILE}"
        exit 1
      fi

      return
    fi

    sleep 1
  done

  echo "The API did not become healthy in time or exited during startup. Recent log output:" >&2
  tail -n 40 "${API_LOG_FILE}" >&2 || true
  stop_process "api" "${API_PID_FILE}"
  stop_process "web ui" "${WEB_PID_FILE}"
  exit 1
}

wait_for_web_health() {
  local web_url="http://${WEB_HOST}:${WEB_PORT}/"
  local pid

  for _ in {1..30}; do
    pid="$(read_pid "${WEB_PID_FILE}")"

    if [[ -z "${pid}" ]] || ! is_pid_running "${pid}"; then
      sleep 1
      continue
    fi

    if curl --silent --show-error --fail "${web_url}" >/dev/null; then
      if ! is_pid_running "${pid}"; then
        echo "The web UI responded once but did not stay running. Recent log output:" >&2
        tail -n 40 "${WEB_LOG_FILE}" >&2 || true
        rm -f "${WEB_PID_FILE}"
        exit 1
      fi

      echo
      echo "Dev-built Chroma runtime is running."
      echo "API: http://${API_HOST}:${API_PORT}/health"
      echo "Web: ${web_url}"
      echo "API PID file: ${API_PID_FILE}"
      echo "Web PID file: ${WEB_PID_FILE}"
      echo "API log: ${API_LOG_FILE}"
      echo "Web log: ${WEB_LOG_FILE}"
      return
    fi

    sleep 1
  done

  echo "The web UI did not become healthy in time or exited during startup. Recent log output:" >&2
  tail -n 40 "${WEB_LOG_FILE}" >&2 || true
  stop_process "web ui" "${WEB_PID_FILE}"
  stop_process "api" "${API_PID_FILE}"
  exit 1
}

start_api() {
  cleanup_stale_pid "${API_PID_FILE}"

  local pid
  pid="$(read_pid "${API_PID_FILE}")"
  if [[ -n "${pid}" ]]; then
    echo "Dev-built api is already running with PID ${pid}."
    return
  fi

  : >"${API_LOG_FILE}"
  chmod 644 "${API_LOG_FILE}"

  echo "Starting compiled API..."
  (
    cd "${RUNTIME_APP_DIR}"
    env \
      NODE_ENV=production \
      CHROMA_HOST="${API_HOST}" \
      CHROMA_PORT="${API_PORT}" \
      CHROMA_APP_DIR="${RUNTIME_APP_DIR}" \
      CHROMA_CONFIG_DIR="${RUNTIME_CONFIG_DIR}" \
      CHROMA_DATA_DIR="${RUNTIME_DATA_DIR}" \
      CHROMA_LOG_DIR="${RUNTIME_LOG_DIR}" \
      CHROMA_WEB_DIST_DIR="${RUNTIME_WEB_DIST_DIR}" \
      setsid bash -c 'echo $$ > "$1"; exec node "$2"' \
        bash "${API_PID_FILE}" "${RUNTIME_APP_DIR}/dist/server/index.js" \
        >>"${API_LOG_FILE}" 2>&1 </dev/null &
  )
  wait_for_api_health
  chmod 644 "${API_PID_FILE}"
}

start_web() {
  cleanup_stale_pid "${WEB_PID_FILE}"

  local pid
  pid="$(read_pid "${WEB_PID_FILE}")"
  if [[ -n "${pid}" ]]; then
    echo "Dev-built web ui is already running with PID ${pid}."
    return
  fi

  : >"${WEB_LOG_FILE}"
  chmod 644 "${WEB_LOG_FILE}"

  echo "Starting compiled web UI..."
  (
    cd "${REPO_ROOT}"
    env \
      CHROMA_WEB_DIST_DIR="${RUNTIME_WEB_DIST_DIR}" \
      setsid bash -c 'echo $$ > "$1"; exec pnpm exec vite preview src/web --host "$2" --port "$3" --strictPort' \
        bash "${WEB_PID_FILE}" "${WEB_HOST}" "${WEB_PORT}" \
        >>"${WEB_LOG_FILE}" 2>&1 </dev/null &
  )
  wait_for_web_health
  chmod 644 "${WEB_PID_FILE}"
}

reset_database() {
  stop_process "web ui" "${WEB_PID_FILE}"
  stop_process "api" "${API_PID_FILE}"

  rm -rf "${RUNTIME_DATA_DIR}"
  rm -rf "${RUNTIME_CONFIG_DIR}"
  rm -f "${API_LOG_FILE}" "${WEB_LOG_FILE}"

  ensure_runtime_paths
  write_env_file

  echo "Removed saved runtime state from ${RUNTIME_DATA_DIR} and ${RUNTIME_CONFIG_DIR}."
}

main() {
  local command="${1:-"-start"}"

  case "${command}" in
    -start|-build|-stop|-reset)
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: ${command}" >&2
      usage >&2
      exit 1
      ;;
  esac

  require_tools
  ensure_runtime_paths
  cleanup_legacy_files

  case "${command}" in
    -start)
      write_env_file
      if ! runtime_build_exists; then
        echo "No staged runtime build found. Building from src first..."
        build_application
        stage_application_files
      fi
      start_api
      start_web
      ;;
    -build)
      write_env_file
      stop_process "web ui" "${WEB_PID_FILE}"
      stop_process "api" "${API_PID_FILE}"
      build_application
      stage_application_files
      start_api
      start_web
      ;;
    -stop)
      stop_process "web ui" "${WEB_PID_FILE}"
      stop_process "api" "${API_PID_FILE}"
      ;;
    -reset)
      reset_database
      ;;
  esac
}

main "$@"
