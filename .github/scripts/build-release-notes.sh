#!/usr/bin/env bash
# Build the release body for a TizenTube Standalone release.
#
# Usage: build-release-notes.sh <release_sha> <release_version> <app_id> <app_name> <out_file>
#
# The changelog is derived from the merge/squash commits between the previous
# published release and this build, grouped by conventional-commit prefix.
# Version-bump commits made by CI carry no PR number and drop out on their own.
set -euo pipefail

RELEASE_SHA="$1"
RELEASE_VERSION="$2"
APP_ID="$3"
APP_NAME="$4"
OUT="$5"

REPO="${GITHUB_REPOSITORY:-}"

# Previous release = the newest published release that isn't the one being cut.
# Falls back to the newest version tag, then to "no previous release".
PREV_TAG=""
if [ -n "$REPO" ] && command -v gh >/dev/null 2>&1; then
  PREV_TAG=$(gh api "repos/${REPO}/releases" --jq \
    "[.[] | select(.draft == false) | .tag_name] | map(select(. != \"${RELEASE_VERSION}\")) | .[0] // empty" \
    2>/dev/null || true)
fi
# Reject anything that isn't an ancestor of this build: version-string order is
# not history order (a v2.x standalone tag can sort above the current v1.15.x
# line and would drag in every commit since the fork point).
if [ -n "$PREV_TAG" ] && ! git merge-base --is-ancestor "${PREV_TAG}^{commit}" "$RELEASE_SHA" 2>/dev/null; then
  echo "Ignoring ${PREV_TAG}: not an ancestor of ${RELEASE_SHA}" >&2
  PREV_TAG=""
fi
if [ -z "$PREV_TAG" ]; then
  PREV_TAG=$(git describe --tags --abbrev=0 "${RELEASE_SHA}^" 2>/dev/null || true)
  [ "$PREV_TAG" = "$RELEASE_VERSION" ] && PREV_TAG=""
fi

if [ -n "$PREV_TAG" ] && git rev-parse -q --verify "${PREV_TAG}^{commit}" >/dev/null; then
  RANGE="${PREV_TAG}..${RELEASE_SHA}"
else
  # First release, or the previous tag isn't in this clone — describe the last
  # stretch of history rather than the entire project.
  RANGE="${RELEASE_SHA}~50..${RELEASE_SHA}"
  git rev-parse -q --verify "${RELEASE_SHA}~50" >/dev/null || RANGE="$RELEASE_SHA"
fi

# --- collect (pr_number, title) pairs -----------------------------------------
# GitHub merge commits:  "Merge pull request #N from owner/branch" + body=title
# GitHub squash commits: "title (#N)"
declare -a FEATURES=() FIXES=() PORTS=() OTHER=()

while IFS=$'\x1f' read -r -d $'\x1e' subject body; do
  subject="${subject#$'\n'}"
  pr=""
  title=""
  if [[ "$subject" =~ ^Merge\ pull\ request\ \#([0-9]+) ]]; then
    pr="${BASH_REMATCH[1]}"
    title=$(printf '%s' "$body" | sed '/^[[:space:]]*$/d' | head -n1)
  elif [[ "$subject" =~ ^(.*)\ \(\#([0-9]+)\)$ ]]; then
    title="${BASH_REMATCH[1]}"
    pr="${BASH_REMATCH[2]}"
  fi
  [ -z "$pr" ] && continue
  [ -z "$title" ] && title="$subject"

  entry="- ${title} (#${pr})"
  shopt -s nocasematch
  if [[ "$title" == Port\ upstream* ]]; then
    PORTS+=("$entry")
  elif [[ "$title" =~ ^feat(\(.*\))?: ]]; then
    FEATURES+=("$entry")
  elif [[ "$title" =~ ^fix(\(.*\))?: ]]; then
    FIXES+=("$entry")
  else
    OTHER+=("$entry")
  fi
  shopt -u nocasematch
done < <(git log --first-parent --pretty=format:'%s%x1f%b%x1e' "$RANGE")

# --- write the body -----------------------------------------------------------
{
  echo "TizenTube Standalone build from commit \`${RELEASE_SHA}\`, version-synced with the userscript."
  echo "TBI_METADATA: {\"appId\":\"${APP_ID}\",\"appName\":\"${APP_NAME}\"}"
  echo

  section() {
    local heading="$1"; shift
    [ "$#" -eq 0 ] && return 0
    echo "### ${heading}"
    printf '%s\n' "$@"
    echo
  }

  if [ ${#FEATURES[@]} -eq 0 ] && [ ${#FIXES[@]} -eq 0 ] && [ ${#PORTS[@]} -eq 0 ] && [ ${#OTHER[@]} -eq 0 ]; then
    echo "No pull requests were merged since \`${PREV_TAG:-the previous build}\`."
  else
    echo "## What's Changed"
    echo
    section "Features" ${FEATURES[@]+"${FEATURES[@]}"}
    section "Fixes" ${FIXES[@]+"${FIXES[@]}"}
    section "Ported from upstream" ${PORTS[@]+"${PORTS[@]}"}
    section "Other" ${OTHER[@]+"${OTHER[@]}"}
  fi

  if [ -n "$PREV_TAG" ] && [ -n "$REPO" ]; then
    echo "**Full changelog:** https://github.com/${REPO}/compare/${PREV_TAG}...${RELEASE_VERSION}"
  fi
} > "$OUT"

echo "Wrote release notes to $OUT:"
echo "---"
cat "$OUT"
