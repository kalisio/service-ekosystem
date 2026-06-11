#!/usr/bin/env bash
set -euo pipefail
# set -x

# Detect which services need to be built.
#
# Detection strategy (by priority):
#   1. INPUT_SERVICES set -> use those entries directly (manual workflow_dispatch)
#      Format: space-separated package names (e.g. "service-kapture service-geokoder")
#   2. DIFF_RANGE set -> use git diff to find modified service packages
#   3. Neither set    -> compute DIFF_RANGE from GitHub event variables,
#                        or include all services if first push / workflow_dispatch
#
# Cascade rule: changes outside any single service package (the workspace root
# config, the build pipeline) trigger a rebuild of every service.
#
# A package is considered a service if it is named packages/service-* and
# ships a Dockerfile (e.g. service-katalog has no Dockerfile and is excluded).
#
# Output:
#   stdout         -> JSON matrix include array (consumed by GH Actions fromJSON)
#                     [{"package":"service-kapture"}, ...]
#   stderr         -> log messages
#   GITHUB_OUTPUT  -> matrix, has_services (when running in CI)
#
# Usage (dev mode):
#   INPUT_SERVICES="service-kapture service-geokoder" bash ./scripts/detect_services.sh
#   DIFF_RANGE="abc123..def456" bash ./scripts/detect_services.sh
#
# Usage (CI mode):
#   env vars are injected by the workflow, GITHUB_OUTPUT is written automatically.

THIS_FILE=$(readlink -f "${BASH_SOURCE[0]}")
THIS_DIR=$(dirname "$THIS_FILE")

. "$THIS_DIR/kash/kash.sh" >&2

REPO_ROOT=$(git rev-parse --show-toplevel)
PACKAGES_DIR="$REPO_ROOT/packages"

#  Input variables
INPUT_SERVICES="${INPUT_SERVICES:-}"
GITHUB_EVENT_NAME="${GITHUB_EVENT_NAME:-}"
GITHUB_EVENT_BEFORE="${GITHUB_EVENT_BEFORE:-}"
GITHUB_EVENT_AFTER="${GITHUB_EVENT_AFTER:-}"

#  Compute DIFF_RANGE if not explicitly set
if [[ -z "${DIFF_RANGE:-}" ]]; then
    if [[ "${GITHUB_EVENT_NAME}" == "workflow_dispatch" ]]; then
        DIFF_RANGE=""
        echo "-> workflow_dispatch: using INPUT_SERVICES or including all services" >&2
    elif [[ "${GITHUB_EVENT_BEFORE}" == "0000000000000000000000000000000000000000" ]] || \
         [[ -z "${GITHUB_EVENT_BEFORE}" ]]; then
        DIFF_RANGE=""
        echo "-> First push on branch: including all services" >&2
    else
        DIFF_RANGE="${GITHUB_EVENT_BEFORE}..${GITHUB_EVENT_AFTER}"
        echo "-> Push: diff ${DIFF_RANGE}" >&2
    fi
fi

#  Helpers
#  ENTRIES is a bash array of package names
ENTRIES=()

_is_service_package() {
    local PKG="$1"
    # Service packages live under packages/ and follow the service-* naming,
    # and ship a Dockerfile (e.g. service-katalog has none and is excluded).
    [[ "$PKG" == service-* ]] && [[ -f "$PACKAGES_DIR/$PKG/Dockerfile" ]]
}

_add_entry() {
    # Add a single package entry. Dedup.
    local PKG="$1"
    local E
    for E in "${ENTRIES[@]:-}"; do
        [[ "$E" == "$PKG" ]] && return
    done
    ENTRIES+=("$PKG")
}

_add_package() {
    local PKG="$1"
    if ! _is_service_package "$PKG"; then
        echo "-> Skipping non-service package '$PKG'" >&2
        return
    fi
    _add_entry "$PKG"
}

_add_all_services() {
    local PKG_DIR
    for PKG_DIR in "$PACKAGES_DIR"/service-*/; do
        [[ -d "$PKG_DIR" ]] || continue
        local PKG
        PKG=$(basename "$PKG_DIR")
        _add_package "$PKG"
    done
}

_is_cascade_path() {
    local FILE="$1"
    case "$FILE" in
        pnpm-lock.yaml)             return 0 ;;
        pnpm-workspace.yaml)        return 0 ;;
        package.json)               return 0 ;;
        scripts/build_service.sh)   return 0 ;;
        scripts/detect_services.sh) return 0 ;;
        scripts/kash/*)             return 0 ;;
        .github/workflows/main.yaml) return 0 ;;
    esac
    return 1
}

begin_group "Detect services" >&2

# 1: services provided manually
if [[ -n "${INPUT_SERVICES}" ]]; then
    echo "-> Service(s) provided manually: ${INPUT_SERVICES}" >&2
    for TOKEN in ${INPUT_SERVICES}; do
        if ! _is_service_package "$TOKEN"; then
            echo "-> Error: service package '$TOKEN' not found, aborting" >&2
            exit 1
        fi
        _add_entry "$TOKEN"
    done

# 2: no diff range -> include all services
elif [[ -z "${DIFF_RANGE}" ]]; then
    echo "-> No diff range: including all services" >&2
    _add_all_services

# 3: diff range -> detect from git diff
else
    CHANGED_FILES=$(git diff --name-only "${DIFF_RANGE}" 2>/dev/null || true)
    if [[ -z "$CHANGED_FILES" ]]; then
        echo "-> No files changed in diff range" >&2
    fi

    CASCADE=false
    while IFS= read -r FILE; do
        [[ -z "$FILE" ]] && continue
        if _is_cascade_path "$FILE"; then
            echo "-> Cascade trigger: $FILE" >&2
            CASCADE=true
            break
        fi
    done <<< "$CHANGED_FILES"

    if [[ "$CASCADE" == true ]]; then
        echo "-> Cascading to all services" >&2
        _add_all_services
    else
        while IFS= read -r FILE; do
            [[ -z "$FILE" ]] && continue
            case "$FILE" in
                packages/service-*/*)
                    PKG=$(echo "$FILE" | cut -d'/' -f2)
                    _add_package "$PKG"
                    ;;
            esac
        done <<< "$CHANGED_FILES"
    fi
fi

#  Build JSON matrix
if [[ ${#ENTRIES[@]} -eq 0 ]]; then
    MATRIX_JSON='[]'
    HAS_SERVICES=false
    echo "-> No services to process." >&2
else
    MATRIX_JSON=$(printf '%s\n' "${ENTRIES[@]}" \
        | jq -Rn '[inputs | {package: .}]')
    HAS_SERVICES=true
    echo "-> Services to process:" >&2
    echo "$MATRIX_JSON" | jq -r '.[] | "   - \(.package)"' >&2
fi

end_group "Detect services" >&2

#  Write to GITHUB_OUTPUT when running in CI
if [[ "${CI:-false}" == "true" ]] && [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    # JSON must be on a single line for GITHUB_OUTPUT
    MATRIX_ONELINE=$(echo "$MATRIX_JSON" | jq -c '.')
    {
        echo "matrix=${MATRIX_ONELINE}"
        echo "has_services=${HAS_SERVICES}"
    } >> "${GITHUB_OUTPUT}"
fi

echo "$MATRIX_JSON"
