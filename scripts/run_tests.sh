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

## Detect the ref/SHA to diff against to know which packages changed.
##
## Relies on kash's $CI_ID (github / gitlab / travis / empty) instead of
## probing raw env vars directly, so it keeps working whichever CI system
## fronts this repo.
## Echoes the ref on stdout, or an empty string when no usable diff base
## could be resolved (caller should then fall back to running everything).
detect_target_ref() {
    local ZERO_SHA="0000000000000000000000000000000000000000"
    local TARGET_REF=""

    case "$CI_ID" in
        github)
            if [ -n "${GITHUB_BASE_REF:-}" ]; then
                # Pull request: diff against the base branch
                TARGET_REF="origin/${GITHUB_BASE_REF}"
            elif [ -n "${GITHUB_EVENT_BEFORE:-}" ] && [ "${GITHUB_EVENT_BEFORE}" != "$ZERO_SHA" ]; then
                # Push: diff against the commit before the push
                TARGET_REF="${GITHUB_EVENT_BEFORE}"
            fi
            ;;
        gitlab)
            if [ -n "${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-}" ]; then
                TARGET_REF="origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}"
            elif [ -n "${CI_COMMIT_BEFORE_SHA:-}" ] && [ "${CI_COMMIT_BEFORE_SHA}" != "$ZERO_SHA" ]; then
                TARGET_REF="${CI_COMMIT_BEFORE_SHA}"
            fi
            ;;
        "")
            # Local run (no known CI): diff against the default branch so
            # devs still get filtering when iterating on a feature branch.
            TARGET_REF="origin/master"
            ;;
        *)
            # Unhandled CI system (eg. travis): fall back to a full run
            ;;
    esac

    if [ -z "$TARGET_REF" ]; then
        echo ""
        return 0
    fi

    # Branch refs need fetching if missing locally; commit SHAs are only
    # usable if the checkout fetched enough history to contain them.
    if [[ "$TARGET_REF" == origin/* ]]; then
        local BARE_REF="${TARGET_REF#origin/}"
        if ! git -C "$ROOT_DIR" rev-parse --verify --quiet "$TARGET_REF" > /dev/null; then
            # Route to stderr: this function's stdout is captured by the caller
            git -C "$ROOT_DIR" fetch --quiet origin "$BARE_REF" >&2 || TARGET_REF=""
        fi
    elif ! git -C "$ROOT_DIR" rev-parse --verify --quiet "$TARGET_REF" > /dev/null 2>&1; then
        TARGET_REF=""
    fi

    echo "$TARGET_REF"
}

## Override kash's generic run_lib_tests: this repo is a pnpm workspace, so
## instead of testing the whole tree we only test packages changed since the
## detected target ref, falling back to a full run when no ref could be
## resolved (eg. first commit on a branch, shallow clone missing history).
## Expected arguments (same signature as kash's run_lib_tests):
## 1. Root directory
## 2. whether to run SonarQube analysis and publish code quality & coverage results
## 3. node version to be used
## 4. mongo version to be used if required by tests
## 5. whether to skip 'pnpm install' (defaults to false)
run_lib_tests() {
    local LOCAL_ROOT_DIR="$1"
    local RUN_SONAR="$2"
    local NODE_VER="$3"
    local MONGO_VER="$4"
    local SKIP_INSTALL="${5:-false}"

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

    local TARGET_REF
    TARGET_REF=$(detect_target_ref)

    if [ -z "$TARGET_REF" ]; then
        begin_group "Running tests for all packages ..."
        pnpm -r --workspace-concurrency=1 run test
        end_group "Running tests for all packages ..."
    else
        begin_group "Running tests for packages changed since $TARGET_REF ..."
        pnpm --filter="...[${TARGET_REF}]" --workspace-concurrency=1 run test
        end_group "Running tests for packages changed since $TARGET_REF ..."
    fi

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


## Run tests
##

run_lib_tests "$ROOT_DIR" "$RUN_SONAR" "$NODE_VER" "$MONGO_VER" "true"
