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

MAIN_BRANCH="master"
EXTRA_FULL_REBUILD_PATHS=()

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


## Determine which packages need to be run test
##

begin_group "Determining packages to test ..."

# Get target ref
TARGET_REF=$(get_diff_base_ref "$ROOT_DIR" "$MAIN_BRANCH")
if [ -n "$TARGET_REF" ] && should_rebuild_all_packages "$ROOT_DIR" "$TARGET_REF" "${EXTRA_FULL_REBUILD_PATHS[@]}"; then
    TARGET_REF=""
fi

# Log the packages that will be tested
if [ -z "$TARGET_REF" ]; then
    echo "-> Packages to test: all"
else
    CHANGED_PACKAGES=$(get_changed_packages "$ROOT_DIR" "$TARGET_REF" | paste -sd' ')
    echo "-> Packages to test: ${CHANGED_PACKAGES:-(none)}"
fi

end_group "Determining packages to test ..."


## Run tests
##

run_package_tests "$ROOT_DIR" "$RUN_SONAR" "$NODE_VER" "$MONGO_VER" "true" "$TARGET_REF"
