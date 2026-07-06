#!/usr/bin/env bash
set -euo pipefail
# set -x

# Detect which service package is being released from a pushed git tag.
#
# Expected tag format (produced by `pnpm changeset publish`):
#   @kalisio/service-<name>@X.Y.Z       -> service release  (target=service)
#
# The tag is parsed/validated by resolve_release_package (ci-common.sh), which
# also cross-checks the version against the package's package.json.
#
# Output:
#   stderr         -> log messages
#   GITHUB_OUTPUT  -> target, package, version
#
# Usage (dev mode):
#   GITHUB_REF_NAME='@kalisio/service-kapture@1.6.0' bash ./scripts/detect_release.sh
#
# Usage (CI mode):
#   GITHUB_REF_NAME is injected by the workflow on push tag events.

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")
ROOT_DIR=$(dirname "$THIS_DIR")

. "$THIS_DIR/kash/kash.sh" >&2
. "$THIS_DIR/ci-common.sh"

GITHUB_REF_NAME="${GITHUB_REF_NAME:-}"

if [[ -z "$GITHUB_REF_NAME" ]]; then
    echo "-> Error: GITHUB_REF_NAME is not set" >&2
    exit 1
fi

begin_group "Detect release ($GITHUB_REF_NAME)" >&2

# Parse + validate the tag (@<scope>/<package>@<version>) via ci-common
# (set -e aborts here if resolve_release_package fails)
RELEASE=$(resolve_release_package "$GITHUB_REF_NAME")
read -r PKG_NAME TAG_VERSION <<< "$RELEASE"

TARGET="service"
echo "-> Service release: $PKG_NAME v$TAG_VERSION" >&2

end_group "Detect release ($GITHUB_REF_NAME)" >&2

# Write to GITHUB_OUTPUT when running in CI
if [[ "${CI:-false}" == "true" ]] && [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
        echo "target=${TARGET}"
        echo "package=${PKG_NAME}"
        echo "version=${TAG_VERSION}"
    } >> "${GITHUB_OUTPUT}"
fi
