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

EXTRA_FULL_REBUILD_PATHS=()

## Override kash's generic run_lib_tests: this repo is a pnpm workspace, so
## instead of testing the whole tree we only test the packages selected by the
## caller via the target ref, falling back to a full run when the ref is empty.
## Expected arguments:
## 1. Root directory
## 2. whether to run SonarQube analysis and publish code quality & coverage results
## 3. node version to be used
## 4. mongo version to be used if required by tests
## 5. whether to skip 'pnpm install' (defaults to false)
## 6. target ref to diff against (empty -> test every package)
run_lib_tests() {
    local LOCAL_ROOT_DIR="$1"
    local RUN_SONAR="$2"
    local NODE_VER="$3"
    local MONGO_VER="$4"
    local SKIP_INSTALL="${5:-false}"
    local TARGET_REF="${6:-}"

    init_lib_infos "$LOCAL_ROOT_DIR"

    local LIB
    LIB=$(get_lib_name)
    echo "About to run tests for $LIB ..."

    if [ -n "$MONGO_VER" ]; then
        begin_group "Starting mongo $MONGO_VER ..."
        use_mongo "$MONGO_VER"
        k-mongo
        end_group "Starting mongo $MONGO_VER ..."
    fi

    use_node "$NODE_VER"
    ensure_pnpm
    cd "$LOCAL_ROOT_DIR"

    if [ "$SKIP_INSTALL" != "true" ]; then
        begin_group "Installing dependencies ..."
        pnpm install
        end_group "Installing dependencies ..."
    fi

    # All packages, or only those changed since the target ref
    local FILTER="-r"
    [ -n "$TARGET_REF" ] && FILTER="--filter=...[${TARGET_REF}]"

    # --if-present: only run the "test" script in packages that define one,
    # skipping the others (eg. examples, docs) without failing.
    begin_group "Running tests ..."
    pnpm "$FILTER" --workspace-concurrency=1 run --if-present test
    end_group "Running tests ..."

    cd ~-

    if [ "$RUN_SONAR" = true ]; then
        cd "$LOCAL_ROOT_DIR" && sonar-scanner
    fi
}

## Parse options
##

NODE_VER=20
MONGO_VER="7"
CI_STEP_NAME="Run tests"
RUN_SONAR=false
while getopts "m:n:sr:" option; do
    case $option in
        m) # defines mongo version
            MONGO_VER=$OPTARG
            ;;
        n) # defines node version
            NODE_VER=$OPTARG
            ;;
        s) # publish code coverage
            RUN_SONAR=true
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


## Init workspace
##

# Required because it contains the Sonar host URL.
. "$WORKSPACE_DIR/development/workspaces/services/services.sh" service-ekosystem


## Determine which packages need to be run test
##

begin_group "Determining packages to test ..."

# Get target ref
TARGET_REF=$(detect_target_ref)
if [ -n "$TARGET_REF" ] && has_full_rebuild_trigger "$TARGET_REF" "${EXTRA_FULL_REBUILD_PATHS[@]}"; then
    TARGET_REF=""
fi

# Log the packages that will be tested
if [ -z "$TARGET_REF" ]; then
    echo "-> Packages to test: all"
else
    CHANGED_PACKAGES=$(changed_files "$TARGET_REF" | sed -n 's#^packages/\([^/]*\)/.*#\1#p' | sort -u | paste -sd' ')
    echo "-> Packages to test: ${CHANGED_PACKAGES:-(none)}"
fi

end_group "Determining packages to test ..."


## Run tests
##

run_lib_tests "$ROOT_DIR" "$RUN_SONAR" "$NODE_VER" "$MONGO_VER" "true" "$TARGET_REF"
