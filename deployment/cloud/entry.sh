#!/bin/bash
# dx-maps cloud dev server, run by the image's /boot.sh from the cloned repo (see Dockerfile).
#   1. install, 2. pull BRANCH every PULL_INTERVAL s (Vite hot-reloads what changed),
#   3. serve: Vite alone, or behind an OIDC sign-in when OIDC_ISSUER is set.
set -u
cd /app/repo
BRANCH="${BRANCH:-main}"; PORT="${PORT:-5173}"
echo "$(date -u +%FT%TZ) START at $(git rev-parse --short HEAD)" | tee -a /tmp/pull.log
bun install --frozen-lockfile || bun install

(
  while true; do
    sleep "${PULL_INTERVAL:-15}"
    OLD=$(git rev-parse HEAD)
    if git fetch -q --depth 1 origin "$BRANCH"; then
      NEW=$(git rev-parse FETCH_HEAD)
      if [ "$OLD" != "$NEW" ]; then
        CHANGED=$(git diff --name-only "$OLD" "$NEW" 2>/dev/null)
        git reset -q --hard FETCH_HEAD
        echo "$(date -u +%FT%TZ) PULLED ${OLD:0:8} -> ${NEW:0:8}" >> /tmp/pull.log
        # the engine binary is untracked, so rebuild it when its source changed
        if [ "${RUDDER_ENGINE:-0}" = 1 ] && echo "$CHANGED" | grep -q '^backend/rudder-engine/'; then
          (cd backend/rudder-engine && go build -o ../bin/rudder-engine .) >> /tmp/pull.log 2>&1 \
            && echo "$(date -u +%FT%TZ) rudder-engine rebuilt" >> /tmp/pull.log && ENGINE_STALE=1
        fi
      fi
    fi
    # Swap in a rebuilt engine once nobody is dictating: stop the old one by its own PID (never a process
    # group: inside a container that can be PID 1) and the dev server restarts it on the new binary.
    if [ "${ENGINE_STALE:-0}" = 1 ] && curl -s --max-time 3 http://127.0.0.1:5193/api/rudder/status | grep -q '"inUse":false'; then
      for p in /proc/[0-9]*; do
        case "$(readlink "$p/exe" 2>/dev/null)" in
          "/app/repo/backend/bin/rudder-engine (deleted)") kill -TERM "${p#/proc/}" \
            && echo "$(date -u +%FT%TZ) rudder-engine ${p#/proc/} stopped for the new build" >> /tmp/pull.log ;;
        esac
      done
      ENGINE_STALE=0
    fi
  done
) &

CONFIG=/app/repo/deployment/cloud/vite.cloud.config.mjs

# Rudder (optional, RUDDER_ENGINE=1): its voice-to-text engine runs here, fed by the BROWSER's
# microphone (no server mic). The image carries the runtime and the pinned model (/opt/rudder); a copy on
# the persistent volume (/data/rudder) wins when it exists. Setup (checksums + building the engine) runs
# in the BACKGROUND so the site serves at once: until it finishes, /api/rudder answers "starting", then
# the cloud Vite config restarts the dev server once, which starts the engine. /api/rudder stays behind
# the sign-in (it is not a public route). About 1 GB resident.
if [ "${RUDDER_ENGINE:-0}" = 1 ]; then
  if [ -z "${RUDDER_HOME:-}" ]; then
    if ls /data/rudder/models/*.gguf >/dev/null 2>&1; then RUDDER_HOME=/data/rudder; else RUDDER_HOME=/opt/rudder; fi
  fi
  export RUDDER_HOME RUDDER_AUDIO=browser
  # The engine refuses a non-loopback Host header, and Vite's proxy passes the public host through, so
  # EVERY host the container answers on must be listed (an unlisted one leaves Rudder "offline" there).
  # An explicit list, never a wildcard: RUDDER_ALLOW_HOST if set, else the hosts Coolify gives the
  # container (COOLIFY_FQDN, comma-separated), else the host in OIDC_REDIRECT_URL.
  if [ -z "${RUDDER_ALLOW_HOST:-}" ] && [ -n "${COOLIFY_FQDN:-}" ]; then
    RUDDER_ALLOW_HOST=$(printf '%s' "$COOLIFY_FQDN" | sed -E 's#[a-z]+://##g; s#[/:][^,]*##g')
  fi
  if [ -z "${RUDDER_ALLOW_HOST:-}" ] && [ -n "${OIDC_REDIRECT_URL:-}" ]; then
    RUDDER_ALLOW_HOST=$(printf '%s' "$OIDC_REDIRECT_URL" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')
  fi
  echo "[rudder] allowed hosts: ${RUDDER_ALLOW_HOST:-loopback only}"
  export RUDDER_ALLOW_HOST="${RUDDER_ALLOW_HOST:-}"
  # The state file is read by vite.cloud.config.mjs: running -> done | failed.
  echo running > /tmp/rudder-setup.state
  # disown: the `wait -n` at the end must not treat this job finishing as the container's exit.
  ( if bash /app/repo/backend/rudder-engine/setup-runtime.sh >&2; then echo done; else
      echo "[rudder] setup failed: the widget will report the engine offline" >&2; echo failed; fi \
    > /tmp/rudder-setup.state.new && mv /tmp/rudder-setup.state.new /tmp/rudder-setup.state ) &
  disown
fi

if [ -z "${OIDC_ISSUER:-}" ]; then
  # Open, like a laptop: no sign-in.
  export VITE_HOST=0.0.0.0 VITE_PORT="$PORT"
  exec bun x vite --config "$CONFIG"
fi

# OIDC gate: oauth2-proxy owns the public port; Vite listens on localhost behind it, so the Plugin
# Studio, every map and the hot-reload websocket are all behind the same sign-in.
: "${OIDC_CLIENT_ID:?}" "${OIDC_CLIENT_SECRET:?}" "${OIDC_REDIRECT_URL:?}"
if [ -z "${OIDC_ALLOWED_GROUPS:-}" ]; then
  echo "refusing to start: set OIDC_ALLOWED_GROUPS (comma-separated). With open sign-up, anyone could log in." >&2
  exit 1
fi
ALLOW=(); IFS=',' read -ra G <<< "$OIDC_ALLOWED_GROUPS"
for g in "${G[@]}"; do g="${g// /}"; [ -n "$g" ] && ALLOW+=(--allowed-group="$g"); done

# Secrets reach oauth2-proxy through its environment, never its command line.
export OAUTH2_PROXY_CLIENT_SECRET="$OIDC_CLIENT_SECRET"
export OAUTH2_PROXY_COOKIE_SECRET="${OIDC_COOKIE_SECRET:-$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 32)}"

# Backend: PocketBase DEV (/pb/, signed-in) and PROD (/api-prod/, public API only). Schema = the
# migrations in the repo; data = the /data volume. The superuser comes from env, never printed.
MIG=/app/repo/backend/pocketbase/pb_migrations; mkdir -p "$MIG" /data/pb-dev /data/pb-prod /data/cdn
for inst in dev prod; do
  if [ -n "${PB_SUPERUSER_EMAIL:-}" ] && [ -n "${PB_SUPERUSER_PASSWORD:-}" ]; then
    pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" --dir "/data/pb-$inst" >/dev/null 2>&1 \
      && echo "[pb-$inst] superuser set" || echo "[pb-$inst] superuser upsert failed"
  fi
done
# Server-side JS hooks from the REPO are OFF: --hooksDir never points into the pulled tree, so a pb_hooks/
# folder pushed by a plugin writer can't run code (v1 has no per-plugin isolation for hooks). prod runs
# none; dev runs only the team sign-in gate BAKED INTO THE IMAGE (Dockerfile, SHA-256 pinned).
NOHOOKS=/var/empty/pb_hooks_disabled
GATE=/app/pb_hooks_gate
DEV_HOOKS=$NOHOOKS; [ -f "$GATE/team-gate.pb.js" ] && DEV_HOOKS=$GATE
pocketbase serve --http 127.0.0.1:8090 --dir /data/pb-dev --migrationsDir "$MIG" --hooksDir "$DEV_HOOKS" &
pocketbase serve --http 127.0.0.1:8091 --dir /data/pb-prod --migrationsDir "$MIG" --hooksDir "$NOHOOKS" &
bun /app/repo/deployment/cloud/admin.mjs &

# TEAM PB: laptops reach pb-dev's API WITHOUT the site sign-in (DX_PB_URL=https://<host>/pb), and PocketBase
# itself signs people in through the same OIDC provider, members of OIDC_ALLOWED_GROUPS only (the baked
# gate). Fails CLOSED: /pb/api/ is opened only when the gate is in place AND the OIDC setup succeeded;
# otherwise pb-dev stays behind the site sign-in, as before. /pb/_/ (dashboard) and _superusers never open.
PB_PUBLIC=()
if [ -n "${PB_OIDC_CLIENT_SECRET:-}" ]; then
  for _ in $(seq 60); do curl -s -o /dev/null http://127.0.0.1:8090/api/health && break; sleep 0.5; done
  PB_APP_URL="${PB_APP_URL:-$(printf '%s' "$OIDC_REDIRECT_URL" | sed -E 's#^([a-z]+://[^/]+).*#\1#')/pb}"
  if [ "$DEV_HOOKS" = "$GATE" ] && PB_APP_URL="$PB_APP_URL" bun /app/repo/deployment/cloud/pb-oidc.mjs; then
    PB_PUBLIC=(--skip-auth-route='^/pb/api/(health|realtime|oauth2-redirect|batch)$'
               --skip-auth-route='^/pb/api/files/'
               --skip-auth-route='^/pb/api/collections/[^_/][^/]*/')
    echo "[pb-dev] team API open at /pb/api/ (sign-in through PocketBase; dashboard stays gated)"
  else
    echo "[pb-dev] team sign-in NOT configured: /pb/ stays behind the site sign-in" >&2
  fi
fi

VITE_HOST=127.0.0.1 VITE_PORT=5174 bun x vite --config "$CONFIG" &
oauth2-proxy \
  --provider=oidc \
  --oidc-issuer-url="$OIDC_ISSUER" \
  --client-id="$OIDC_CLIENT_ID" \
  --redirect-url="$OIDC_REDIRECT_URL" \
  --code-challenge-method=S256 \
  --scope="${OIDC_SCOPE:-openid profile email groups}" \
  --oidc-groups-claim="${OIDC_GROUPS_CLAIM:-groups}" \
  "${ALLOW[@]}" \
  --email-domain='*' \
  --provider-display-name="${OIDC_DISPLAY_NAME:-your identity provider}" \
  --upstream=http://127.0.0.1:5174/ \
  --upstream=http://127.0.0.1:5175/cdn/ \
  --upstream=http://127.0.0.1:5175/api-prod/ \
  --upstream=http://127.0.0.1:5175/pb/ \
  --upstream=http://127.0.0.1:5175/admin/ \
  --skip-auth-route='^/cdn/' \
  --skip-auth-route='^/api-prod/api/' \
  "${PB_PUBLIC[@]}" \
  --http-address="0.0.0.0:$PORT" \
  --reverse-proxy=true \
  --cookie-secure=true \
  --cookie-samesite=lax &
wait -n
exit $?
