#!/bin/bash
# build-cdn.sh — one public build of the PRODUCTION branch into /data/cdn, one at a time.
#   main is the shared sandbox the dev server follows; the public build comes only from
#   PRODUCTION_BRANCH (default production), which moves when someone promotes main to it.
#   fetch that branch into its own ref -> snapshot it -> apply ITS public exclusions ->
#   the build steps WITHOUT the gates (memory-capped) -> check the output -> the exclusion check again
#   (refuses the swap) -> atomic swap of /data/cdn/current.
# No gates here: they already passed before the commit reached main, and a full gate run on a
# 2-vCPU container takes most of an hour. The public exclusions are NOT a gate and always run.
# Exit 75 = another build holds the lock. To stop a build, kill the PID in /tmp/build-cdn.pid
# (never a process group: inside a container the group can be PID 1, i.e. the whole container).
set -u
exec 9>/tmp/build-cdn.lock
flock -n 9 || { echo "another build is running"; exit 75; }
echo $$ > /tmp/build-cdn.pid
cd /app/repo
PB="${PRODUCTION_BRANCH:-production}"
# Its own ref, and no FETCH_HEAD: the dev server's pull loop uses FETCH_HEAD for main at the same time.
git fetch -q --no-write-fetch-head --depth 1 origin "+refs/heads/$PB:refs/cdn/$PB" \
  || { echo "cannot fetch branch '$PB' (create it with: git push origin main:$PB)"; exit 1; }
SHA=$(git rev-parse --short "refs/cdn/$PB"); SNAP=/tmp/build-$SHA
rm -rf "$SNAP"; mkdir -p "$SNAP"
git archive "refs/cdn/$PB" | tar -x -C "$SNAP" || { echo "snapshot failed"; exit 1; }
# The exclusion list and checker come from the branch being published, so loosening them takes a
# promotion too (falls back to the dev server's copy for a branch older than the list).
SRC="$SNAP/deployment/cloud"; [ -f "$SRC/apply-exclusions.sh" ] && [ -f "$SRC/public-exclusions.txt" ] || SRC=/app/repo/deployment/cloud
EXDIR=/tmp/exclusions-$SHA; rm -rf "$EXDIR"; mkdir -p "$EXDIR"
cp "$SRC/apply-exclusions.sh" "$SRC/public-exclusions.txt" "$EXDIR/"   # the script reads the list beside it
bash "$EXDIR/apply-exclusions.sh" "$SNAP"
# Dependencies: reuse the dev server's install when the lockfile is the same, else install for this commit.
if cmp -s "$SNAP/bun.lock" /app/repo/bun.lock; then
  ln -s /app/repo/node_modules "$SNAP/node_modules"
else
  echo "$(date -u +%FT%TZ) $PB's lockfile differs from main's: installing its dependencies"
  (cd "$SNAP" && bun install --frozen-lockfile >/dev/null) || { echo "dependency install failed"; rm -rf "$SNAP"; exit 1; }
fi
cd "$SNAP"
echo "$(date -u +%FT%TZ) building $SHA"
export NODE_OPTIONS="--max-old-space-size=${BUILD_MAX_OLD_SPACE_MB:-1536}"
for step in clean token build:bundles tree check:sri; do
  nice -n 10 bun run "$step" || { echo "build failed at $step"; rm -rf "$SNAP"; exit 1; }
done
OUT="$SNAP/public/dx-maps"
[ -f "$OUT/manifest.json" ] || { echo "no manifest.json in the output"; rm -rf "$SNAP"; exit 1; }
bun -e 'console.log("window.MAP_API_BASE=" + JSON.stringify(process.env.PUBLIC_API_BASE || "") + ";")' > "$OUT/runtime-config.js"
NEW=/data/cdn/build-$SHA
rm -rf "$NEW"; mkdir -p /data/cdn; mv "$SNAP/public" "$NEW"
bash "$EXDIR/apply-exclusions.sh" --check "$NEW" || { echo "REFUSED: excluded content in the build; not published"; rm -rf "$NEW" "$SNAP" "$EXDIR"; exit 1; }
ln -sfn "$NEW" /data/cdn/current.tmp && mv -T /data/cdn/current.tmp /data/cdn/current
echo "$SHA" > /data/cdn/COMMIT
find /data/cdn -maxdepth 1 -name 'build-*' ! -path "$NEW" -exec rm -rf {} +
rm -rf "$SNAP" "$EXDIR"
echo "$(date -u +%FT%TZ) published $SHA ($PB) at /cdn/dx-maps/"
