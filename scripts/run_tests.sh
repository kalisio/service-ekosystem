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
            trap 'slack_ci_report "$ROOT_DIR" "$CI_STEP_NAME" "$?" "$SLACK_WEBHOOK_SERVICES"' EXIT
            ;;
        *)
            ;;
    esac
done


## Init workspace
##

. "$WORKSPACE_DIR/development/workspaces/services/services.sh" service-ekosystem

## Run tests
##

#run_lib_tests "$ROOT_DIR" "$RUN_SONAR" "$NODE_VER" "$MONGO_VER"

## Run tests
##

init_lib_infos "$ROOT_DIR"

LIB=$(get_lib_name)
VERSION=$(get_lib_version)

echo "About to run tests for $LIB v$VERSION..."

## Start mongo
##

if [ -n "$MONGO_VER" ]; then
    begin_group "Starting mongo $MONGO_VER ..."

    use_mongo "$MONGO_VER"
    k-mongo

    end_group "Starting mongo $MONGO_VER ..."
fi

## Run tests
##

use_node "$NODE_VER"
pnpm test


## Run SonarQube analysis and publish code quality & coverage reports
##
if [ "$RUN_SONAR" = true ]; then
    cd "$ROOT_DIR" && sonar-scanner
fi
