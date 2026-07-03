#!/usr/bin/env bash
set -euo pipefail
# set -x

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")
ROOT_DIR=$(dirname "$THIS_DIR")
WORKSPACE_DIR="$(dirname "$ROOT_DIR")"

. "$THIS_DIR/kash/kash.sh"
. "$THIS_DIR/ci-common.sh"

## Monorepo configuration
##

PACKAGE_PREFIX="service-"
EXTRA_FULL_REBUILD_PATHS=()


slack_report() {
    slack_ci_report "$ROOT_DIR" "$CI_STEP_NAME" "$KASH_EXIT_CODE" "$SLACK_WEBHOOK_SERVICES"
}

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
        p) # publish image
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

## Resolve the packages to build
##

PACKAGES=()
PACKAGES_LIST=$(select_packages_to_build)
[ -n "$PACKAGES_LIST" ] && mapfile -t PACKAGES <<< "$PACKAGES_LIST"

if [ ${#PACKAGES[@]} -eq 0 ]; then
    echo "-> No package to build."
    exit 0
fi

echo "-> Packages to build: ${PACKAGES[*]}"

## Build (and optionally publish) each resolved package, one by one
##

load_env_files "$WORKSPACE_DIR/development/common/kalisio_dockerhub.enc.env"
decrypt_stdout "$WORKSPACE_DIR/development/common/KALISIO_DOCKERHUB_PASSWORD.enc.value" | docker login --username "$KALISIO_DOCKERHUB_USERNAME" --password-stdin "$KALISIO_DOCKERHUB_URL"

for PKG in "${PACKAGES[@]}"; do
    init_lib_infos "$ROOT_DIR/packages/$PKG"
    # Use the monorepo's tag/branch rather than the package subdirectory's
    LIB_INFOS[2]=$(get_git_tag "$ROOT_DIR")
    LIB_INFOS[3]=$(get_git_branch "$ROOT_DIR")

    NAME=$(get_lib_name)
    VERSION=$(get_lib_version)
    GIT_TAG=$(get_lib_tag)
    NAME=${NAME#*/} # strip @scope/

    # Image keeps the legacy standalone repo name, ie. the package name without
    # its monorepo prefix (eg. service-kapture -> kapture)
    IMAGE_NAME="$KALISIO_DOCKERHUB_URL/kalisio/${NAME#"$PACKAGE_PREFIX"}"
    IMAGE_SHORT_TAG=dev
    [ -n "$GIT_TAG" ] && IMAGE_SHORT_TAG=$VERSION
    IMAGE_TAG="$IMAGE_SHORT_TAG-node$NODE_VER-$DEBIAN_VER"

    begin_group "Building container $IMAGE_NAME:$IMAGE_TAG ..."

    # Build context is the monorepo root, see packages/$PKG/Dockerfile
    DOCKER_BUILDKIT=1 docker build \
        --build-arg NODE_VERSION="$NODE_VER" \
        --build-arg DEBIAN_VERSION="$DEBIAN_VER" \
        -f "packages/$PKG/Dockerfile" \
        -t "$IMAGE_NAME:$IMAGE_TAG" \
        "$ROOT_DIR"

    if [ "$PUBLISH" = true ]; then
        docker push "$IMAGE_NAME:$IMAGE_TAG"
        if [ "$NODE_VER" = "$DEFAULT_NODE_VER" ] && [ "$DEBIAN_VER" = "$DEFAULT_DEBIAN_VER" ]; then
            docker tag "$IMAGE_NAME:$IMAGE_TAG" "$IMAGE_NAME:$IMAGE_SHORT_TAG"
            docker push "$IMAGE_NAME:$IMAGE_SHORT_TAG"
        fi
    fi

    end_group "Building container $IMAGE_NAME:$IMAGE_TAG ..."
done

docker logout "$KALISIO_DOCKERHUB_URL"
