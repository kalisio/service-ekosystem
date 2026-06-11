#!/usr/bin/env bash
set -euo pipefail
# set -x

# Detect which service package is being released from a pushed git tag.
#
# Expected tag format (produced by `pnpm changeset publish`):
#   @kalisio/service-<name>@X.Y.Z
#
# Strategy:
#   1. Parse GITHUB_REF_NAME with the regex ^@([^/]+)/(service-[^/]+)@(.+)$
#   2. Resolve the package directory under packages/
#   3. Cross-check the parsed version against package.json.version (must match)
#
# Output:
#   stderr         -> log messages
#   GITHUB_OUTPUT  -> target, package, version
#
# Exits non-zero on:
#   - tag that doesn't match the expected format '@<scope>/service-<name>@<version>'
#   - unknown package (no matching directory under packages/)
#   - mismatch between tag version and package.json.version
#
# Usage (dev mode):
#   GITHUB_REF_NAME='@kalisio/service-kapture@1.6.0' bash ./scripts/detect_release.sh
#
# Usage (CI mode):
#   GITHUB_REF_NAME is injected by the workflow on push tag events.

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")

. "$THIS_DIR/kash/kash.sh" >&2

REPO_ROOT=$(git rev-parse --show-toplevel)
PACKAGES_DIR="$REPO_ROOT/packages"

GITHUB_REF_NAME="${GITHUB_REF_NAME:-}"

if [[ -z "$GITHUB_REF_NAME" ]]; then
    echo "-> Error: GITHUB_REF_NAME is not set" >&2
    exit 1
fi

begin_group "Detect release ($GITHUB_REF_NAME)" >&2

#  Parse tag : @<scope>/<service-name>@<version>
if [[ ! "$GITHUB_REF_NAME" =~ ^@([^/]+)/(service-[^/]+)@(.+)$ ]]; then
    echo "-> Error: tag '$GITHUB_REF_NAME' does not match expected format '@<scope>/service-<name>@<version>'" >&2
    exit 1
fi

SCOPE="${BASH_REMATCH[1]}"
PKG_NAME="${BASH_REMATCH[2]}"
TAG_VERSION="${BASH_REMATCH[3]}"

echo "-> scope=$SCOPE package=$PKG_NAME version=$TAG_VERSION" >&2

#  Resolve package directory.
PKG_DIR="$PACKAGES_DIR/$PKG_NAME"
if [[ ! -d "$PKG_DIR" ]]; then
    echo "-> Error: package directory '$PKG_DIR' does not exist" >&2
    exit 1
fi

#  Cross-check package.json.version against tag.
PKG_VERSION=$(jq -r '.version' "$PKG_DIR/package.json")
if [[ "$PKG_VERSION" != "$TAG_VERSION" ]]; then
    echo "-> Error: tag version '$TAG_VERSION' does not match $PKG_NAME/package.json version '$PKG_VERSION'" >&2
    exit 1
fi

TARGET="service"
echo "-> target=$TARGET package=$PKG_NAME version=$TAG_VERSION" >&2

end_group "Detect release ($GITHUB_REF_NAME)" >&2

#  Write to GITHUB_OUTPUT when running in CI
if [[ "${CI:-false}" == "true" ]] && [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
        echo "target=${TARGET}"
        echo "package=${PKG_NAME}"
        echo "version=${TAG_VERSION}"
    } >> "${GITHUB_OUTPUT}"
fi
