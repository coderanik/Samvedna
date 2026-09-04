#!/usr/bin/env bash
# Start Samvedna web focused on a role dashboard (counselor | admin).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROLE="${1:-}"
case "$ROLE" in
  counselor)
    PORT="${WEB_PORT:-3001}"
    DIST="${NEXT_DIST_DIR:-.next-counselor}"
    PATH_OPEN="/counselor/cases"
    LABEL="Counsellor dashboard"
    PORTAL_ENV="counselor"
    ;;
  admin)
    PORT="${WEB_PORT:-3002}"
    DIST="${NEXT_DIST_DIR:-.next-admin}"
    PATH_OPEN="/admin"
    LABEL="Admin dashboard"
    PORTAL_ENV="admin"
    ;;
  *)
    echo "Usage: $0 counselor|admin" >&2
    exit 1
    ;;
esac

export WEB_PORT="$PORT"
export NEXT_DIST_DIR="$DIST"
export NEXT_PUBLIC_PORTAL="${PORTAL_ENV:-}"

# Serialize Next startups so they don't race-edit tsconfig.json
LOCKDIR="${TMPDIR:-/tmp}/samvedna-next-start.lock"
acquire_lock() {
  local tries=60
  while ! mkdir "$LOCKDIR" 2>/dev/null; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      echo "Timed out waiting for Next.js start lock" >&2
      exit 1
    fi
    sleep 1
  done
  trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT
}

wait_for_http() {
  local port="$1" tries="${2:-90}"
  for _ in $(seq 1 "$tries"); do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/login" 2>/dev/null || true)
    if [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "302" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_api() {
  if curl -sf -o /dev/null "http://127.0.0.1:4000/health" 2>/dev/null; then
    echo "API already running on :4000"
    return 0
  fi
  echo "Starting API on :4000…"
  nohup pnpm --filter @samvedna/api dev > /tmp/samvedna-api-role.log 2>&1 &
  disown || true
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null "http://127.0.0.1:4000/health" 2>/dev/null && return 0
    sleep 0.5
  done
  echo "Warning: API did not become ready on :4000 (see /tmp/samvedna-api-role.log)" >&2
}

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "$LABEL already listening on :$PORT — opening browser"
  open "http://localhost:${PORT}${PATH_OPEN}" 2>/dev/null || true
  open "http://localhost:${PORT}/login" 2>/dev/null || true
  exit 0
fi

ensure_api
acquire_lock

echo "== Samvedna $LABEL =="
echo "Web:  http://localhost:${PORT}${PATH_OPEN}"
echo "Login: http://localhost:${PORT}/login"
echo ""

(
  # Hold lock until this instance answers HTTP, then release for the other role
  if wait_for_http "$PORT" 120; then
    rmdir "$LOCKDIR" 2>/dev/null || true
    open "http://localhost:${PORT}${PATH_OPEN}" 2>/dev/null || true
    open "http://localhost:${PORT}/login" 2>/dev/null || true
  else
    rmdir "$LOCKDIR" 2>/dev/null || true
  fi
) &

cd "$REPO"
# Clear EXIT trap lock — background waiter owns release
trap - EXIT

exec env WEB_PORT="$PORT" NEXT_DIST_DIR="$DIST" NEXT_PUBLIC_PORTAL="${PORTAL_ENV:-}" \
  SOCKET_CORS_ORIGIN="http://localhost:3000,http://localhost:3001,http://localhost:3002" \
  pnpm --filter @samvedna/web dev
