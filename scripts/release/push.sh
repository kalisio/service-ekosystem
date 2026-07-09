#!/usr/bin/env bash
set -euo pipefail

# postrelease hook: push the release tag(s) created on HEAD to origin.
#
# Pushing a changeset-style tag "@<scope>/service-<name>@<version>" is what
# triggers the CI build_package release build.

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
ROOT_DIR=$(dirname "$(dirname "$(dirname "$THIS_FILE")")")
cd "$ROOT_DIR"

mapfile -t TAGS < <(git tag --points-at HEAD | grep -E '^@[^/]+/.+@.+$' || true)

if [ ${#TAGS[@]} -eq 0 ]; then
    echo "-> No release tag on HEAD to push."
    exit 0
fi

for TAG in "${TAGS[@]}"; do
    git push origin "$TAG"
    echo "-> Pushed ${TAG}"
done
