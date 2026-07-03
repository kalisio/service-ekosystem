#!/usr/bin/env bash
# Shared CI helpers for the monorepo scripts (run_tests.sh, build_service.sh).
#
# Sourced *after* kash.sh. Assumes the sourcing script defines $ROOT_DIR (repo
# root). Package-specific config (prefix, extra full-rebuild paths) is passed as
# arguments to the helpers; select_packages_to_build also reads $NODE_VER and
# the optional $INPUT_PACKAGES env override.
# These helpers only log (no begin_group/end_group — grouping is the caller's
# job). Requires kash's $CI_ID, plus git and pnpm.

if [[ -n "${CI_COMMON_LOADED:-}" ]]; then
    return 0 2>/dev/null || exit 0
fi
CI_COMMON_LOADED=1

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

    # Highlight which packages the filter will select (changed since the ref
    # + their dependents). Everything goes to stderr because this function's
    # stdout is the return channel captured by the caller.
    if [ -n "$TARGET_REF" ]; then
        local SELECTED
        SELECTED=$( (cd "$ROOT_DIR" && pnpm --filter="...[${TARGET_REF}]" exec node -p "require('./package.json').name") 2>/dev/null || true)
        echo "-> Packages changed since $TARGET_REF:" >&2
        if [ -z "$SELECTED" ]; then
            echo "   (none)" >&2
        else
            echo "$SELECTED" | sed 's/^/   - /' >&2
        fi
    fi

    echo "$TARGET_REF"
}

# A package is buildable if it lives under packages/<prefix>* and ships a
# Dockerfile (eg. service-k2 has none and is excluded).
# Arg1: the package directory name
# Arg2: the package prefix
_is_buildable_package() {
    local PKG="$1"
    local PREFIX="$2"
    [[ "$PKG" == "${PREFIX}"* ]] && [ -f "$ROOT_DIR/packages/$PKG/Dockerfile" ]
}

# Return 0 if changing the given file should rebuild every package. Covers the
# built-in shared paths (workspace config, lockfile, CI scripts) plus any extra
# glob patterns passed as additional arguments.
# Arg1: the changed file path
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

# Append a package to the PACKAGES array (of the caller), avoiding duplicates.
_add_package() {
    local PKG="$1" E
    for E in "${PACKAGES[@]:-}"; do [[ "$E" == "$PKG" ]] && return; done
    PACKAGES+=("$PKG")
}

# Append every buildable package of the monorepo to the caller's PACKAGES array.
# Arg1: the package prefix
_add_all_packages() {
    local PREFIX="$1"
    local D PKG
    for D in "$ROOT_DIR"/packages/"${PREFIX}"*/; do
        [ -d "$D" ] || continue
        PKG=$(basename "$D")
        _is_buildable_package "$PKG" "$PREFIX" && _add_package "$PKG"
    done
}

# Resolve the packages to build and print them on stdout, one per line.
# All logs go to stderr: stdout is the return channel.
# Arg1:  the package prefix
# Arg2+: extra path globs forcing a full rebuild (optional)
# Resolution order:
#   1. INPUT_PACKAGES set -> exactly those (manual dispatch / release)
#   2. otherwise          -> packages changed since the target ref, falling back
#                            to all packages when a shared path changed or no
#                            diff base could be resolved.
## Uses globals: INPUT_PACKAGES (env), NODE_VER
select_packages_to_build() {
    local PREFIX="$1"
    shift
    local EXTRA_PATHS=("$@")
    local PACKAGES=()

    if [ -n "${INPUT_PACKAGES:-}" ]; then
        echo "-> Package(s) requested explicitly: $INPUT_PACKAGES" >&2
        local TOKEN
        for TOKEN in $INPUT_PACKAGES; do
            if ! _is_buildable_package "$TOKEN" "$PREFIX"; then
                echo "-> Error: package '$TOKEN' not found or has no Dockerfile" >&2
                return 1
            fi
            _add_package "$TOKEN"
        done
    else
        use_node "$NODE_VER" >&2
        ensure_pnpm >&2
        local TARGET_REF
        TARGET_REF=$(detect_target_ref)

        if [ -z "$TARGET_REF" ]; then
            echo "-> No usable diff base -> building all packages" >&2
            _add_all_packages "$PREFIX"
        else
            local CHANGED FILE FULL=false
            CHANGED=$(git -C "$ROOT_DIR" diff --name-only "$TARGET_REF" 2>/dev/null || true)
            while IFS= read -r FILE; do
                [ -n "$FILE" ] || continue
                if _triggers_full_rebuild "$FILE" "${EXTRA_PATHS[@]}"; then
                    echo "-> Shared path changed ($FILE) -> building all packages" >&2
                    FULL=true
                    break
                fi
            done <<< "$CHANGED"

            if [ "$FULL" = true ]; then
                _add_all_packages "$PREFIX"
            else
                local SELECTED DIR PKG
                SELECTED=$( (cd "$ROOT_DIR" && pnpm --filter="...[${TARGET_REF}]" exec pwd) 2>/dev/null || true)
                while IFS= read -r DIR; do
                    [ -n "$DIR" ] || continue
                    PKG=$(basename "$DIR")
                    _is_buildable_package "$PKG" "$PREFIX" && _add_package "$PKG"
                done <<< "$SELECTED"
            fi
        fi
    fi

    # Return the resolved packages, one per line
    [ ${#PACKAGES[@]} -gt 0 ] && printf '%s\n' "${PACKAGES[@]}"
    return 0
}
