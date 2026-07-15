#!/usr/bin/env bash
# Shared CI helpers for the Kalisio monorepos (run_tests.sh, build_package.sh).
#
# Package/image selection is delegated to pnpm's own `--filter` (both tests and
# builds); these helpers only resolve the diff base, decide what to build/tag and
# publish the resulting images.
#
# Sourced *after* kash.sh. Every helper takes the repo root explicitly (no
# reliance on globals). Requires kash's $CI_ID and helpers
# (get_custom_from_git_ref, use_*, …), plus git and pnpm.

## Detect the ref/SHA to diff against to know which packages changed.
##
## Relies on kash's $CI_ID (github / gitlab / travis / empty) instead of
## probing raw env vars directly, so it keeps working whichever CI system
## fronts this repo.
## Echoes the ref on stdout, or an empty string when no usable diff base
## could be resolved (caller should then fall back to processing everything).
## All informational output goes to stderr: stdout is the return channel.
## Arg1: the repository root
## Arg2: the main branch to diff against locally (optional, defaults to master)
get_diff_base_ref() {
    local REPO_DIR="$1"
    local MAIN_BRANCH="${2:-master}"
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
            TARGET_REF="origin/${MAIN_BRANCH}"
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
        if ! git -C "$REPO_DIR" rev-parse --verify --quiet "$TARGET_REF" > /dev/null; then
            # Route to stderr: this function's stdout is captured by the caller
            git -C "$REPO_DIR" fetch --quiet origin "$BARE_REF" >&2 || TARGET_REF=""
        fi
    elif ! git -C "$REPO_DIR" rev-parse --verify --quiet "$TARGET_REF" > /dev/null 2>&1; then
        TARGET_REF=""
    fi

    echo "$TARGET_REF"
}

# List the directory names of the packages changed since the given ref.
# Arg1: the repository root  Arg2: the target ref
get_changed_packages() {
    git -C "$1" diff --name-only "$2" 2>/dev/null \
        | sed -n 's#^packages/\([^/]*\)/.*#\1#p' | sort -u
}

# Return 0 if any file changed since the ref should force a full rebuild: shared
# paths (lockfile, workspace config, root package.json, CI scripts & workflows)
# or any of the extra glob patterns passed as additional arguments.
# Arg1:  the repository root
# Arg2:  the target ref
# Arg3+: extra glob patterns forcing a full rebuild (optional)
should_rebuild_all_packages() {
    local REPO_DIR="$1"
    local TARGET_REF="$2"
    shift 2
    local FILE PATTERN
    while IFS= read -r FILE; do
        [ -n "$FILE" ] || continue
        case "$FILE" in
            pnpm-lock.yaml|pnpm-workspace.yaml|package.json) return 0 ;;
            scripts/*|.github/workflows/*)                   return 0 ;;
        esac
        for PATTERN in "$@"; do
            # shellcheck disable=SC2254
            case "$FILE" in
                $PATTERN) return 0 ;;
            esac
        done
    done < <(git -C "$REPO_DIR" diff --name-only "$TARGET_REF" 2>/dev/null)
    return 1
}

# Resolve, from the git context, WHICH packages to build (a pnpm --filter
# expression) and the short image tag. Echoes two lines: the filter, then the
# short tag. Logs to stderr and returns 1 on an invalid release tag / package.
#
# Cases (priority order):
#   INPUT non-empty       -> exactly those packages           (manual dispatch)
#   release tag           -> that one package, tag = <version> (@<scope>/<prefix>x@ver)
#   branch != main branch -> changed packages,  tag = <dev>-<custom>
#   main branch (default) -> changed packages,  tag = <dev>
#
# Args:
#   1. ROOT_DIR              2. package prefix (eg. service-)
#   3. base dev tag (eg. dev)
#   4. INPUT packages (space-separated dir names, may be empty)
#   5. GIT_TAG               6. GIT_BRANCH
#   7. main branch (eg. master): gets the plain <dev> tag; others get <dev>-<custom>
#   8+ extra globs forcing a full rebuild (optional)
resolve_build_filter_and_tag() {
    local ROOT="$1"
    local PREFIX="$2"
    local DEV_TAG="$3"
    local INPUT="$4"
    local GIT_TAG="$5"
    local GIT_BRANCH="$6"
    local MAIN_BRANCH="$7"
    shift 7
    local FILTER=""
    local SHORT_TAG="$DEV_TAG"

    if [ -n "$INPUT" ]; then
        local PKG
        # Accept comma- and/or space-separated package lists.
        for PKG in ${INPUT//,/ }; do
            if [ ! -d "$ROOT/packages/$PKG" ]; then
                echo "-> Error: package '$PKG' not found" >&2
                return 1
            fi
            FILTER="$FILTER --filter=./packages/$PKG"
        done
    elif [ -n "$GIT_TAG" ]; then
        if [[ ! "$GIT_TAG" =~ ^@([^/]+)/(${PREFIX}[^/@]+)@(.+)$ ]]; then
            echo "-> Error: tag '$GIT_TAG' does not match '@<scope>/${PREFIX}<name>@<version>'" >&2
            return 1
        fi
        local PKG="${BASH_REMATCH[2]}" VER="${BASH_REMATCH[3]}" PKG_VER
        PKG_VER=$(jq -r '.version' "$ROOT/packages/$PKG/package.json" 2>/dev/null || echo "")
        if [ "$PKG_VER" != "$VER" ]; then
            echo "-> Error: tag version '$VER' does not match packages/$PKG/package.json version '$PKG_VER'" >&2
            return 1
        fi
        FILTER="--filter=./packages/$PKG"
        SHORT_TAG="$VER"
    else
        local TARGET_REF
        TARGET_REF=$(get_diff_base_ref "$ROOT" "$MAIN_BRANCH")
        # Always scope to packages/<prefix>* so non-service workspace projects
        # (docs/, examples/, the root) — which may also have a 'build' script —
        # are never built here.
        if [ -z "$TARGET_REF" ] || should_rebuild_all_packages "$ROOT" "$TARGET_REF" "$@"; then
            FILTER="--filter=./packages/${PREFIX}*"
        else
            FILTER="--filter=./packages/${PREFIX}*[${TARGET_REF}]"
        fi
    fi

    # Non-release builds: 'dev', or 'dev-<custom>' on any branch but the main one.
    if [ -z "$GIT_TAG" ] && [ -n "$GIT_BRANCH" ] && [ "$GIT_BRANCH" != "$MAIN_BRANCH" ]; then
        local CUSTOM
        CUSTOM=$(get_custom_from_git_ref "$GIT_BRANCH")
        [ -z "$CUSTOM" ] && CUSTOM="${GIT_BRANCH//\//-}"
        SHORT_TAG="$DEV_TAG-$CUSTOM"
    fi

    printf '%s\n%s\n' "$FILTER" "$SHORT_TAG"
}

# Push the images this run just built. For each package under packages/<prefix>*,
# if its <namespace>/<name>:<IMAGE_TAG> image exists locally (ie. it was built),
# push it — plus the short-tag alias on the default node/debian combo. Assumes
# the caller is already `docker login`-ed.
# Args:
#   1. ROOT_DIR       2. package prefix        3. registry URL
#   4. image namespace (eg. kalisio)
#   5. IMAGE_TAG      6. SHORT_TAG
#   7. node version   8. debian version
#   9. default node   10. default debian
publish_images() {
    local ROOT="$1"
    local PREFIX="$2"
    local REGISTRY="$3"
    local NAMESPACE="$4"
    local IMAGE_TAG="$5"
    local SHORT_TAG="$6"
    local NODE_VER="$7"
    local DEBIAN_VER="$8"
    local DEF_NODE="$9"
    local DEF_DEBIAN="${10}"
    local D PKG IMAGE_NAME
    for D in "$ROOT"/packages/"$PREFIX"*/; do
        [ -d "$D" ] || continue
        PKG=$(basename "$D")
        IMAGE_NAME="$REGISTRY/$NAMESPACE/${PKG#"$PREFIX"}"

        # Only publish images that this run actually built.
        docker image inspect "$IMAGE_NAME:$IMAGE_TAG" > /dev/null 2>&1 || continue

        begin_group "Publishing $IMAGE_NAME:$IMAGE_TAG ..."
        docker push "$IMAGE_NAME:$IMAGE_TAG"
        if [ "$NODE_VER" = "$DEF_NODE" ] && [ "$DEBIAN_VER" = "$DEF_DEBIAN" ]; then
            docker tag "$IMAGE_NAME:$IMAGE_TAG" "$IMAGE_NAME:$SHORT_TAG"
            docker push "$IMAGE_NAME:$SHORT_TAG"
        fi
        end_group "Publishing $IMAGE_NAME:$IMAGE_TAG ..."
    done
}

## Override kash's generic run_package_tests: these repos are pnpm workspaces, so
## instead of testing the whole tree we only test the packages selected by the
## caller via the target ref, falling back to a full run when the ref is empty.
## Expected arguments:
## 1. Root directory
## 2. whether to run SonarQube analysis and publish code quality & coverage results
## 3. node version to be used
## 4. mongo version to be used if required by tests
## 5. whether to skip 'pnpm install' (defaults to false)
## 6. target ref to diff against (empty -> test every package)
run_package_tests() {
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

# Push every job image this run built. For each package under packages/<prefix>*,
# derive its image tags from the very `build*` scripts that `pnpm run "/^build/"`
# executed (single source of truth with the build):
#   build           -> <registry>/<namespace>/<pkg>:<IMAGE_TAG>
#   build:<variant> -> <registry>/<namespace>/<pkg>:<variant>-<IMAGE_TAG>
# so any variant naming (incl. a frequency suffix, eg. paquetobs-observations-6m)
# is preserved exactly. Only images that exist locally (ie. were built by the
# selected filter) are pushed. Assumes the caller is already `docker login`-ed.
# Args:
#   1. ROOT_DIR       2. package prefix (eg. krawler-)
#   3. registry URL   4. image namespace (eg. kalisio)
#   5. IMAGE_TAG
publish_job_images() {
    local ROOT="$1"
    local PREFIX="$2"
    local REGISTRY="$3"
    local NAMESPACE="$4"
    local IMAGE_TAG="$5"
    local D PKG IMAGE KEY ITAG
    for D in "$ROOT"/packages/"$PREFIX"*/; do
        [ -f "$D/package.json" ] || continue
        PKG=$(basename "$D")
        IMAGE="$REGISTRY/$NAMESPACE/$PKG"
        while IFS= read -r KEY; do
            if [ "$KEY" = "build" ]; then
                ITAG="$IMAGE_TAG"
            else
                ITAG="${KEY#build:}-$IMAGE_TAG"
            fi
            # Only publish images that this run actually built.
            docker image inspect "$IMAGE:$ITAG" > /dev/null 2>&1 || continue
            begin_group "Publishing $IMAGE:$ITAG ..."
            docker push "$IMAGE:$ITAG"
            end_group "Publishing $IMAGE:$ITAG ..."
        done < <(jq -r '.scripts // {} | keys[] | select(. == "build" or startswith("build:"))' "$D/package.json")
    done
}