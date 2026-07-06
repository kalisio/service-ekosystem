#!/usr/bin/env bash
# Shared CI helpers for the Kalisio monorepos (run_tests.sh, build_package.sh).
#
# This file is meant to be IDENTICAL across monorepos (service-ekosystem,
# krawler-ekosystem, ...). It only holds generic, package-type-agnostic
# primitives. Everything specific to a repo (how a buildable package/job is
# identified, variants, the build itself) lives in that repo's build_package.sh.
#
# Sourced *after* kash.sh. Assumes the sourcing script defines $ROOT_DIR (repo
# root). These helpers only log to stderr (no begin_group/end_group — grouping
# is the caller's job). Requires kash's $CI_ID, plus git (and pnpm for tests).

## Detect the ref/SHA to diff against to know which packages changed.
##
## Relies on kash's $CI_ID (github / gitlab / travis / empty) instead of
## probing raw env vars directly, so it keeps working whichever CI system
## fronts this repo.
## Echoes the ref on stdout, or an empty string when no usable diff base
## could be resolved (caller should then fall back to processing everything).
## All informational output goes to stderr: stdout is the return channel.
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

# List the files changed since the given ref.
# Arg1: the target ref
changed_files() {
    git -C "$ROOT_DIR" diff --name-only "$1" 2>/dev/null || true
}

# List the directory names of the packages changed since the ref.
# Arg1: the target ref
changed_package_names() {
    changed_files "$1" | sed -n 's#^packages/\([^/]*\)/.*#\1#p' | sort -u
}

# Return 0 if changing the given file should rebuild every package. Covers the
# built-in shared paths (workspace config, lockfile, CI scripts, workflows)
# plus any extra glob patterns passed as additional arguments.
# Arg1:  the changed file path
# Arg2+: extra glob patterns to match against (optional)
_triggers_full_rebuild() {
    local FILE="$1"
    shift
    case "$FILE" in
        pnpm-lock.yaml|pnpm-workspace.yaml|package.json) return 0 ;;
        scripts/*)                                       return 0 ;;
        .github/workflows/*)                             return 0 ;;
    esac
    local PATTERN
    for PATTERN in "$@"; do
        # shellcheck disable=SC2254
        case "$FILE" in
            $PATTERN) return 0 ;;
        esac
    done
    return 1
}

# Return 0 if any file changed since the ref triggers a full rebuild.
# Arg1:  the target ref
# Arg2+: extra glob patterns forcing a full rebuild (optional)
has_full_rebuild_trigger() {
    local TARGET_REF="$1"
    shift
    local FILE
    while IFS= read -r FILE; do
        [ -n "$FILE" ] || continue
        _triggers_full_rebuild "$FILE" "$@" && return 0
    done <<< "$(changed_files "$TARGET_REF")"
    return 1
}

# Append a value to the caller's PACKAGES array, avoiding duplicates.
_add_package() {
    local PKG="$1" E
    for E in "${PACKAGES[@]:-}"; do [[ "$E" == "$PKG" ]] && return; done
    PACKAGES+=("$PKG")
}

# A package is buildable if it lives under packages/<prefix>* and ships a
# dockerfile (case-insensitive: Dockerfile, dockerfile, or dockerfile.<variant>).
# Arg1: the package directory name  Arg2: the package prefix
_is_buildable_package() {
    local PKG="$1" PREFIX="$2" DF
    [[ "$PKG" == "${PREFIX}"* ]] || return 1
    for DF in "$ROOT_DIR/packages/$PKG"/[Dd]ockerfile*; do
        [ -e "$DF" ] && return 0
    done
    return 1
}

# Append every buildable package of the monorepo to the caller's PACKAGES array.
# Arg1: the package prefix
_add_all_packages() {
    local PREFIX="$1" D PKG
    for D in "$ROOT_DIR"/packages/"${PREFIX}"*/; do
        [ -d "$D" ] || continue
        PKG=$(basename "$D")
        _is_buildable_package "$PKG" "$PREFIX" && _add_package "$PKG"
    done
}

# Resolve the buildable packages and print them on stdout, one per line.
# Arg1:  the package prefix
# Arg2+: extra path globs forcing a full rebuild (optional)
# Resolution order:
#   1. INPUT_PACKAGES set -> exactly those (manual dispatch / release)
#   2. otherwise          -> packages changed since the target ref, falling back
#                            to all packages on a shared change or no diff base.
select_packages_to_build() {
    local PREFIX="$1"
    shift
    local EXTRA_PATHS=("$@")
    local PACKAGES=()

    if [ -n "${INPUT_PACKAGES:-}" ]; then
        local TOKEN
        for TOKEN in $INPUT_PACKAGES; do
            if ! _is_buildable_package "$TOKEN" "$PREFIX"; then
                echo "-> Error: package '$TOKEN' not found or not buildable" >&2
                return 1
            fi
            _add_package "$TOKEN"
        done
    else
        local TARGET_REF
        TARGET_REF=$(detect_target_ref)
        if [ -z "$TARGET_REF" ] || has_full_rebuild_trigger "$TARGET_REF" "${EXTRA_PATHS[@]}"; then
            _add_all_packages "$PREFIX"
        else
            local PKG
            while IFS= read -r PKG; do
                [ -n "$PKG" ] || continue
                _is_buildable_package "$PKG" "$PREFIX" && _add_package "$PKG"
            done <<< "$(changed_package_names "$TARGET_REF")"
        fi
    fi

    [ ${#PACKAGES[@]} -gt 0 ] && printf '%s\n' "${PACKAGES[@]}"
    return 0
}

# Parse a Changesets release tag "@<scope>/<package>@<version>", verify the
# package exists under packages/ and that its package.json version matches the
# tag. Echoes "<package> <version>" on stdout; logs errors to stderr, returns 1.
# Uses global: $ROOT_DIR
resolve_release_package() {
    local REF_NAME="$1"
    if [[ ! "$REF_NAME" =~ ^@([^/]+)/(.+)@(.+)$ ]]; then
        echo "-> Error: tag '$REF_NAME' does not match '@<scope>/<package>@<version>'" >&2
        return 1
    fi
    local PKG="${BASH_REMATCH[2]}" VER="${BASH_REMATCH[3]}"
    if [ ! -d "$ROOT_DIR/packages/$PKG" ]; then
        echo "-> Error: package directory 'packages/$PKG' does not exist" >&2
        return 1
    fi
    local PKG_VER
    PKG_VER=$(jq -r '.version' "$ROOT_DIR/packages/$PKG/package.json")
    if [ "$PKG_VER" != "$VER" ]; then
        echo "-> Error: tag version '$VER' does not match packages/$PKG/package.json version '$PKG_VER'" >&2
        return 1
    fi
    echo "$PKG $VER"
}

# Build a Docker image (passing NODE_VERSION/DEBIAN_VERSION build-args) and,
# when publishing, push it and alias it to its short tag (dev / version) — but
# only for the default node/debian combo, so the short tag always points at the
# canonical build. The caller is responsible for `docker login` beforehand.
# Args:
#   1. build context directory
#   2. dockerfile path
#   3. image name without tag (eg. <registry>/kalisio/foo)
#   4. short tag (eg. dev or 1.2.3)
#   5. node version           6. debian version
#   7. default node version   8. default debian version
#   9. publish (true/false)
build_and_publish_image() {
    local CONTEXT="$1" DOCKERFILE="$2" IMAGE_NAME="$3" SHORT_TAG="$4"
    local NODE_VER="$5" DEBIAN_VER="$6" DEF_NODE="$7" DEF_DEBIAN="$8" PUBLISH="$9"
    local IMAGE_TAG="$SHORT_TAG-node$NODE_VER-$DEBIAN_VER"

    begin_group "Building container $IMAGE_NAME:$IMAGE_TAG ..."
    DOCKER_BUILDKIT=1 docker build \
        --build-arg NODE_VERSION="$NODE_VER" \
        --build-arg DEBIAN_VERSION="$DEBIAN_VER" \
        -f "$DOCKERFILE" \
        -t "$IMAGE_NAME:$IMAGE_TAG" \
        "$CONTEXT"
    if [ "$PUBLISH" = true ]; then
        docker push "$IMAGE_NAME:$IMAGE_TAG"
        if [ "$NODE_VER" = "$DEF_NODE" ] && [ "$DEBIAN_VER" = "$DEF_DEBIAN" ]; then
            docker tag "$IMAGE_NAME:$IMAGE_TAG" "$IMAGE_NAME:$SHORT_TAG"
            docker push "$IMAGE_NAME:$SHORT_TAG"
        fi
    fi
    end_group "Building container $IMAGE_NAME:$IMAGE_TAG ..."
}

## Override kash's generic run_lib_tests: these repos are pnpm workspaces, so
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
