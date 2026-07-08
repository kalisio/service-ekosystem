#!/usr/bin/env bash
set -euo pipefail

# postbump hook: commit the version bump produced by `changeset version`.
#
# Detects the service package.json file(s) whose version just changed and
# commits everything (bumped package.json, CHANGELOG, consumed changesets) with:
#   "chore: bump Kapture service to v1.6.1"                  (single service)
#   "chore: bump services (service-a v1.2.3, service-b v…)"  (several at once)

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
ROOT_DIR=$(dirname "$(dirname "$(dirname "$THIS_FILE")")")
cd "$ROOT_DIR"

# service package.json files changed (unstaged) by `changeset version`
mapfile -t CHANGED < <(git diff --name-only | grep -E '^packages/[^/]+/package\.json$' || true)

if [ ${#CHANGED[@]} -eq 0 ]; then
    echo "-> No service version bump detected; nothing to commit."
    exit 0
fi

BUMPED=()   # "shortname:version" entries
for FILE in "${CHANGED[@]}"; do
    NAME=$(jq -r '.name' "$FILE")
    VERSION=$(jq -r '.version' "$FILE")
    SHORT=${NAME##*/}          # service-kapture
    SHORT=${SHORT#service-}    # kapture
    BUMPED+=("$SHORT:$VERSION")
done

if [ ${#BUMPED[@]} -eq 1 ]; then
    SHORT=${BUMPED[0]%:*}
    VERSION=${BUMPED[0]#*:}
    MESSAGE="chore: bump ${SHORT^} service to v${VERSION}"   # ^ = capitalize
else
    LIST=""
    for ENTRY in "${BUMPED[@]}"; do
        LIST+="service-${ENTRY%:*} v${ENTRY#*:}, "
    done
    MESSAGE="chore: bump services (${LIST%, })"
fi

git add -A
git commit -m "$MESSAGE"
echo "-> Committed: $MESSAGE"
