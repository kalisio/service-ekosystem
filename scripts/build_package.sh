#!/usr/bin/env bash
set -euo pipefail
# set -x

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")
ROOT_DIR=$(dirname "$THIS_DIR")
WORKSPACE_DIR="$(dirname "$ROOT_DIR")"

. "$THIS_DIR/kash/kash.sh"

slack_report() {
    slack_ci_report "$ROOT_DIR" "$CI_STEP_NAME" "$KASH_EXIT_CODE" "$SLACK_WEBHOOK_SERVICES"
}

## Monorepo configuration
##

PACKAGE_PREFIX="service-"
DOCKER_NAMESPACE="kalisio"
DEV_TAG="dev"
MAIN_BRANCH="master"
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
    "$(get_git_tag "$ROOT_DIR")" "$(get_git_branch "$ROOT_DIR")" "$MAIN_BRANCH" \
    "${EXTRA_FULL_REBUILD_PATHS[@]}")
FILTER=${FILTER_AND_TAG%%$'\n'*}
SHORT_TAG=${FILTER_AND_TAG##*$'\n'}
IMAGE_TAG="$SHORT_TAG-node$NODE_VER-$DEBIAN_VER"

echo "-> Filter: $FILTER"
echo "-> Image tag: $IMAGE_TAG"

end_group "Determining what to build ..."

## Build the images
##

begin_group "Building images ..."

use_node "$NODE_VER"
ensure_pnpm

load_env_files "$WORKSPACE_DIR/development/common/kalisio_dockerhub.enc.env"

export KALISIO_DOCKERHUB_URL
export IMAGE_TAG
export NODE_VERSION="$NODE_VER"
export DEBIAN_VERSION="$DEBIAN_VER"

pnpm $FILTER --workspace-concurrency=1 run "/^build/"

end_group "Building images ..."

## Publish the images that were actually built
##

[ "$PUBLISH" = true ] || exit 0

decrypt_stdout "$WORKSPACE_DIR/development/common/KALISIO_DOCKERHUB_PASSWORD.enc.value" | docker login --username "$KALISIO_DOCKERHUB_USERNAME" --password-stdin "$KALISIO_DOCKERHUB_URL"

publish_images \
    "$ROOT_DIR" "$PACKAGE_PREFIX" "$KALISIO_DOCKERHUB_URL" "$DOCKER_NAMESPACE" \
    "$IMAGE_TAG" "$SHORT_TAG" \
    "$NODE_VER" "$DEBIAN_VER" "$DEFAULT_NODE_VER" "$DEFAULT_DEBIAN_VER"

docker logout "$KALISIO_DOCKERHUB_URL"
