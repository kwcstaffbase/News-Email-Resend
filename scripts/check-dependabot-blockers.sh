#!/usr/bin/env bash
# CI gate: enforce that a dependabot ignore-block stays in lock-step with the
# actual dependency version. Today this enforces one invariant:
#
#   If `client/package.json` declares `@staffbase/design` at v17 or higher,
#   `.github/dependabot.yml` MUST NOT carry the
#   `version-update:semver-major` ignore for `@staffbase/design`.
#
# Rationale: the ignore was added in PR #85 because the plugin was on
# `@staffbase/design` ^16 and v18 introduced breaking changes we couldn't
# accept as an unattended auto-bump. Once the migration to v17/v18 lands,
# the block becomes stale — keeping it would silently swallow future major
# releases and bit-rot the repo.
#
# Fail mode: prints the conflicting block and exits non-zero so the PR
# cannot merge. Resolve by removing the `@staffbase/design` entry from the
# `ignore:` list in `.github/dependabot.yml`.
#
# Design choices (addressing PR #87 review):
#   1. FAIL CLOSED on tooling errors. If `node` is unavailable, package.json
#      is malformed, or the major version can't be parsed, the script exits
#      non-zero rather than silently passing. Stale ignore can't slip through
#      a broken probe.
#   2. STRUCTURAL parse of dependabot.yml. We don't rely on `update-types`
#      being on the line immediately after `dependency-name` — we extract
#      the `ignore:` block by indentation, split it into items at sibling
#      `-` markers, and check each item-as-a-whole for the co-occurrence of
#      `@staffbase/design` and `version-update:semver-major`. Reordered
#      keys, multi-line list syntax, and embedded comments are all handled.
#
# Extending: add new invariants below. Each invariant should be a small
# self-contained block with its own probe.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="${REPO_ROOT}/client/package.json"
DEPBOT="${REPO_ROOT}/.github/dependabot.yml"

if [[ ! -f "$PKG" ]]; then
  echo "skip: ${PKG} not found (no client workspace)"
  exit 0
fi

if [[ ! -f "$DEPBOT" ]]; then
  echo "skip: ${DEPBOT} not found"
  exit 0
fi

# --- Invariant 1: @staffbase/design >= 17 ⇒ no semver-major ignore ----------

# Probe the declared @staffbase/design version. FAIL CLOSED on any error:
# missing node, malformed package.json, etc. — we must not let a tooling
# failure mask a stale ignore.
if ! command -v node >/dev/null 2>&1; then
  echo "FAIL: 'node' is required to read ${PKG}" >&2
  exit 1
fi

if ! DS_VERSION=$(node -e "
  const pkg = require('${PKG}');
  const v = (pkg.dependencies || {})['@staffbase/design']
         || (pkg.devDependencies || {})['@staffbase/design']
         || '';
  console.log(v);
"); then
  echo "FAIL: could not parse ${PKG} (node exited non-zero)" >&2
  exit 1
fi

if [[ -z "$DS_VERSION" ]]; then
  # Dependency isn't declared at all — invariant trivially satisfied.
  echo "skip: @staffbase/design not in client/package.json"
  exit 0
fi

# Strip range prefixes (^ ~ >= etc.) and extract the major version.
DS_MAJOR=$(printf '%s' "$DS_VERSION" | sed -E 's/^[^0-9]*([0-9]+).*/\1/')
if ! [[ "$DS_MAJOR" =~ ^[0-9]+$ ]]; then
  echo "FAIL: could not extract major version from '@staffbase/design': '${DS_VERSION}'" >&2
  exit 1
fi

# Detect whether dependabot.yml carries a @staffbase/design + semver-major
# entry inside an `ignore:` block. Structural parse — see "Design choices"
# above. Outputs the offending item-as-a-whole on stdout, empty if none.
OFFENDING_ITEM=$(awk '
  function leading_ws(s,   i) {
    for (i = 1; i <= length(s); i++) {
      if (substr(s, i, 1) != " ") return i - 1
    }
    return length(s)
  }
  function flush_item() {
    if (in_item \
        && item_text ~ /"@staffbase\/design"/ \
        && item_text ~ /version-update:semver-major/) {
      print item_text
      found = 1
    }
    in_item = 0
    item_text = ""
  }
  BEGIN { in_ignore = 0; in_item = 0; ignore_indent = -1; item_indent = -1; item_text = "" }
  # Detect the start of an `ignore:` block.
  /^[[:space:]]*ignore:[[:space:]]*$/ {
    flush_item()
    ignore_indent = leading_ws($0)
    in_ignore = 1
    next
  }
  in_ignore {
    # Empty / pure-comment lines: keep accumulating to the current item so
    # comments embedded inside an entry stay attached.
    if ($0 ~ /^[[:space:]]*$/ || $0 ~ /^[[:space:]]*#/) {
      if (in_item) item_text = item_text "\n" $0
      next
    }
    ws = leading_ws($0)
    # De-indent to or past the `ignore:` line ends the block.
    if (ws <= ignore_indent) {
      flush_item()
      if (found) exit
      in_ignore = 0
      next
    }
    # A line starting with `-` is a new sibling item ONLY when its indent is
    # the same as the current item indent (or this is the first item, where
    # item_indent has not been set yet). A `-` at a deeper indent is a
    # sub-list element (e.g. multi-line `update-types: \n - "..."`) and must
    # stay attached to the current item.
    if ($0 ~ /^[[:space:]]*-[[:space:]]+/ && (item_indent < 0 || ws <= item_indent)) {
      flush_item()
      if (found) exit
      in_item = 1
      item_indent = ws
      item_text = $0
      next
    }
    # Otherwise, this is a continuation line of the current item.
    if (in_item) item_text = item_text "\n" $0
  }
  END {
    flush_item()
  }
' "$DEPBOT")

if [[ -n "$OFFENDING_ITEM" && "$DS_MAJOR" -ge 17 ]]; then
  cat >&2 <<EOF

FAIL: dependabot blocker is stale
---------------------------------
client/package.json declares @staffbase/design at "${DS_VERSION}" (major=${DS_MAJOR}),
but .github/dependabot.yml still carries the v17-blocker:

${OFFENDING_ITEM}

This block was added in PR #85 (applaunchpad) / PR #4 (glossary) while the
plugin was on @staffbase/design ^16, to prevent unattended jumps to v18.
The migration is now landed, so the block is stale — keeping it would
silently swallow future major releases.

Remove the @staffbase/design entry from the ignore: list in
.github/dependabot.yml in the same PR that bumps @staffbase/design past v16.

EOF
  exit 1
fi

echo "ok: dependabot blockers are consistent with client/package.json (@staffbase/design=${DS_VERSION}, major=${DS_MAJOR})"
