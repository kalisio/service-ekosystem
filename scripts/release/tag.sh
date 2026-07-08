#!/usr/bin/env bash
set -euo pipefail

# release: create the git release tag(s) for the service(s) bumped by HEAD.
#
# The bump commit (created by `pnpm bump`) changed one or more
# packages/<service>/package.json. For each, create the changeset-style tag
# "<name>@<version>" (eg. @kalisio/service-kapture@1.6.1) — which build_package
# then recognises as a release. Existing tags are skipped.
#
# (Service packages are private, so `changeset publish`/`tag` never emit these
# tags; we create them ourselves.)

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
ROOT_DIR=$(dirname "$(dirname "$(dirname "$THIS_FILE")")")
cd "$ROOT_DIR"

# package.json files bumped by the last commit
mapfile -t FILES < <(git show --name-only --pretty=format: HEAD | grep -E '^packages/[^/]+/package\.json$' || true)

if [ ${#FILES[@]} -eq 0 ]; then
    echo "-> HEAD does not bump any service; run 'pnpm bump' first." >&2
    exit 1
fi

for FILE in "${FILES[@]}"; do
    NAME=$(jq -r '.name' "$FILE")
    VERSION=$(jq -r '.version' "$FILE")
    TAG="${NAME}@${VERSION}"   # e.g. @kalisio/service-kapture@1.6.1
    if git rev-parse -q --verify "refs/tags/${TAG}" > /dev/null; then
        echo "-> Tag ${TAG} already exists, skipping"
        continue
    fi
    git tag "$TAG"
    echo "-> Tagged ${TAG}"
done
