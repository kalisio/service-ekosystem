#!/usr/bin/env bash
set -euo pipefail
# set -x

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

## Determine which packages need to be built
##

begin_group "Determining packages to build ..."

# Get the packages to build
PACKAGES_LIST=$(select_packages_to_build "$PACKAGE_PREFIX" "${EXTRA_FULL_REBUILD_PATHS[@]}")

# Log the packages that will be built
PACKAGES_LOG=$(echo "$PACKAGES_LIST" | paste -sd' ')
echo "-> Packages to build: ${PACKAGES_LOG:-(none)}"

end_group "Determining packages to build ..."

# Resolve into an array; nothing to build -> done
PACKAGES=()
[ -n "$PACKAGES_LIST" ] && mapfile -t PACKAGES <<< "$PACKAGES_LIST"
[ ${#PACKAGES[@]} -eq 0 ] && exit 0

## Build each package
##

load_env_files "$WORKSPACE_DIR/development/common/kalisio_dockerhub.enc.env"
decrypt_stdout "$WORKSPACE_DIR/development/common/KALISIO_DOCKERHUB_PASSWORD.enc.value" | docker login --username "$KALISIO_DOCKERHUB_USERNAME" --password-stdin "$KALISIO_DOCKERHUB_URL"

for PKG in "${PACKAGES[@]}"; do
    init_lib_infos "$ROOT_DIR/packages/$PKG"

    NAME=$(get_lib_name)
    VERSION=$(get_lib_version)
    GIT_TAG=$(get_lib_tag)

    # Strip the @scope/ prefix, then the package prefix (service-foo -> foo)
    NAME=${NAME#*/}
    IMAGE_NAME="$KALISIO_DOCKERHUB_URL/kalisio/${NAME#"$PACKAGE_PREFIX"}"

    SHORT_TAG=dev
    [ -n "$GIT_TAG" ] && SHORT_TAG=$VERSION

    build_and_publish_image "$ROOT_DIR" "packages/$PKG/Dockerfile" "$IMAGE_NAME" "$SHORT_TAG" \
        "$NODE_VER" "$DEBIAN_VER" "$DEFAULT_NODE_VER" "$DEFAULT_DEBIAN_VER" "$PUBLISH"
done

docker logout "$KALISIO_DOCKERHUB_URL"
