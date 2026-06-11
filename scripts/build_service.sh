#!/usr/bin/env bash
set -euo pipefail
# set -x

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")
ROOT_DIR=$(dirname "$THIS_DIR")
WORKSPACE_DIR="$(dirname "$ROOT_DIR")"

. "$THIS_DIR/kash/kash.sh"

## Parse options
##

DEFAULT_NODE_VER=20
DEFAULT_DEBIAN_VER=bookworm
NODE_VER=$DEFAULT_NODE_VER
DEBIAN_VER=$DEFAULT_DEBIAN_VER
PACKAGE=""
PUBLISH=false
CI_STEP_NAME="Build service"
while getopts "j:d:n:pr:" option; do
    case $option in
        j) # service package directory name under packages/
            PACKAGE=$OPTARG
            ;;
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
            trap 'slack_ci_report "$ROOT_DIR" "$CI_STEP_NAME" "$?" "$SLACK_WEBHOOK_SERVICES"' EXIT
            ;;
        *)
            ;;
    esac
done

if [ -z "$PACKAGE" ]; then
    echo "Usage: $0 -j <package> [-n <node>] [-d <debian>] [-p] [-r <step>]" >&2
    exit 1
fi

## Init workspace
##

init_lib_infos "$ROOT_DIR/packages/$PACKAGE"

# Use the monorepo's tag/branch rather than the package subdirectory's
LIB_INFOS[2]=$(get_git_tag "$ROOT_DIR")
LIB_INFOS[3]=$(get_git_branch "$ROOT_DIR")

NAME=$(get_lib_name)
VERSION=$(get_lib_version)
GIT_TAG=$(get_lib_tag)

# Strip @kalisio/ prefix
NAME=${NAME#*/}

echo "About to build $NAME v$VERSION ..."

load_env_files "$WORKSPACE_DIR/development/common/kalisio_dockerhub.enc.env"
load_value_files "$WORKSPACE_DIR/development/common/KALISIO_DOCKERHUB_PASSWORD.enc.value"

## Build container
##

IMAGE_NAME="$KALISIO_DOCKERHUB_URL/kalisio/$NAME"
IMAGE_SHORT_TAG=latest

if [[ -n "$GIT_TAG" ]]; then
    IMAGE_SHORT_TAG=$VERSION
fi

IMAGE_TAG="$IMAGE_SHORT_TAG-node$NODE_VER-$DEBIAN_VER"

begin_group "Building container $IMAGE_NAME:$IMAGE_TAG ..."

docker login --username "$KALISIO_DOCKERHUB_USERNAME" --password-stdin "$KALISIO_DOCKERHUB_URL" < "$KALISIO_DOCKERHUB_PASSWORD"
# Build context is the monorepo root, see packages/$PACKAGE/Dockerfile
DOCKER_BUILDKIT=1 docker build \
    --build-arg NODE_VERSION="$NODE_VER" \
    --build-arg DEBIAN_VERSION="$DEBIAN_VER" \
    -f "packages/$PACKAGE/Dockerfile" \
    -t "$IMAGE_NAME:$IMAGE_TAG" \
    "$ROOT_DIR"

if [ "$PUBLISH" = true ]; then
    docker push "$IMAGE_NAME:$IMAGE_TAG"
    if [ "$NODE_VER" = "$DEFAULT_NODE_VER" ] && [ "$DEBIAN_VER" = "$DEFAULT_DEBIAN_VER" ]; then
        docker tag "$IMAGE_NAME:$IMAGE_TAG" "$IMAGE_NAME:$IMAGE_SHORT_TAG"
        docker push "$IMAGE_NAME:$IMAGE_SHORT_TAG"
    fi
fi

docker logout "$KALISIO_DOCKERHUB_URL"

end_group "Building container $IMAGE_NAME:$IMAGE_TAG ..."
