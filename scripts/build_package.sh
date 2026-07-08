#!/usr/bin/env bash
set -euo pipefail
# set -x

# Build (and optionally publish) the service Docker images.
#
# Two phases:
#   1. build   -> `pnpm --filter=<...> run build`: each package's own `build`
#                 script does the docker build, tagging <registry>/<ns>/<name>
#                 with the $IMAGE_TAG / node / debian we export here.
#   2. publish -> push every image this run just built (see publish_images).
#
# What gets built (pnpm filter) and how it's tagged is resolved by
# resolve_build_filter_and_tag from the git ref, so it behaves the same on GitHub/GitLab.

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")
ROOT_DIR=$(dirname "$THIS_DIR")
WORKSPACE_DIR="$(dirname "$ROOT_DIR")"

. "$THIS_DIR/kash/kash.sh"
. "$THIS_DIR/ci-common.sh"

slack_report() {
    slack_ci_report "$ROOT_DIR" "$CI_STEP_NAME" "$KASH_EXIT_CODE" "$SLACK_WEBHOOK_SERVICES"
}

## Monorepo configuration
##

PACKAGE_PREFIX="service-"
# Docker Hub namespace the package `build` scripts tag their images under.
IMAGE_NAMESPACE="kalisio"
# Base tag for non-release (development) images: 'dev', or 'dev-<custom>' on a
# branch other than master.
DEV_TAG="dev"
# Extra path globs that, when changed, force rebuilding every package (on top of
# the built-in shared paths: lockfile, workspace config, scripts, workflows).
EXTRA_FULL_REBUILD_PATHS=()

## Parse options
##

DEFAULT_NODE_VER=20
DEFAULT_DEBIAN_VER=bookworm
NODE_VER=$DEFAULT_NODE_VER
DEBIAN_VER=$DEFAULT_DEBIAN_VER
PUBLISH=false
CI_STEP_NAME="Build package"
while getopts "d:n:pr:" option; do
    case $option in
        d) # defines debian version
            DEBIAN_VER=$OPTARG
            ;;
        n) # defines node version
            NODE_VER=$OPTARG
            ;;
        p) # publish images to the registry
            PUBLISH=true
            ;;
        r) # report outcome to slack
            CI_STEP_NAME=$OPTARG
            load_env_files "$WORKSPACE_DIR/development/common/SLACK_WEBHOOK_SERVICES.enc.env"
            add_function_to_trap slack_report
            ;;
        *)
            ;;
    esac
done

## Determine what to build (pnpm filter) and how to tag it (short tag)
##

begin_group "Determining what to build ..."

FILTER_AND_TAG=$(resolve_build_filter_and_tag \
    "$ROOT_DIR" "$PACKAGE_PREFIX" "$DEV_TAG" "${INPUT_PACKAGES:-}" \
    "$(get_git_tag "$ROOT_DIR")" "$(get_git_branch "$ROOT_DIR")" \
    "${EXTRA_FULL_REBUILD_PATHS[@]}")
FILTER=${FILTER_AND_TAG%%$'\n'*}
SHORT_TAG=${FILTER_AND_TAG##*$'\n'}
IMAGE_TAG="$SHORT_TAG-node$NODE_VER-$DEBIAN_VER"

echo "-> Filter: $FILTER"
echo "-> Image tag: $IMAGE_TAG"

end_group "Determining what to build ..."

## Build the images (each package's own `build` script)
##

use_node "$NODE_VER"

load_env_files "$WORKSPACE_DIR/development/common/kalisio_dockerhub.enc.env"

export KALISIO_DOCKERHUB_URL
export IMAGE_TAG
export NODE_VERSION="$NODE_VER"
export DEBIAN_VERSION="$DEBIAN_VER"

begin_group "Building images ..."
# Run every 'build*' script (build, build:<variant>, …) of each selected
# package; pnpm exits 0 for packages that have none, so no --if-present needed.
# shellcheck disable=SC2086
pnpm $FILTER --workspace-concurrency=1 run "/^build/"
end_group "Building images ..."

## Publish the images that were actually built
##

[ "$PUBLISH" = true ] || exit 0

decrypt_stdout "$WORKSPACE_DIR/development/common/KALISIO_DOCKERHUB_PASSWORD.enc.value" | docker login --username "$KALISIO_DOCKERHUB_USERNAME" --password-stdin "$KALISIO_DOCKERHUB_URL"

publish_images \
    "$ROOT_DIR" "$PACKAGE_PREFIX" "$KALISIO_DOCKERHUB_URL" "$IMAGE_NAMESPACE" \
    "$IMAGE_TAG" "$SHORT_TAG" \
    "$NODE_VER" "$DEBIAN_VER" "$DEFAULT_NODE_VER" "$DEFAULT_DEBIAN_VER"

docker logout "$KALISIO_DOCKERHUB_URL"
