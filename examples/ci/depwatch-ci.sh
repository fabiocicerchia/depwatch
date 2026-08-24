#!/usr/bin/env sh
#
# depwatch in any CI that is not GitHub Actions.
#
# GitHub Actions users want the composite action in this repository's root
# (`uses: fabiocicerchia/depwatch@v0`) — it does everything below and adds a job
# summary, a pull request comment and step outputs. Everywhere else, this is that
# action's behaviour in one POSIX shell script: install depwatch, optionally
# measure the base branch, then gate.
#
# It is POSIX sh, not bash, because half the images this runs in are Alpine.
#
# Configuration is entirely through the environment, since that is the one thing
# every platform on this list agrees on:
#
#   MANIFEST                what to measure           (default package.json)
#   MAX_LIBYEARS            absolute drift budget     (default unset: no gate)
#   MAX_REPLACE             cap on "replace" deps     (default unset: no gate)
#   MAX_LIBYEARS_INCREASE   the ratchet — how much drift this change may add
#   BASE_REF                what the ratchet compares against, e.g. main
#   DEPWATCH_REF            git ref of depwatch to build (default main; pin it)
#   DEPWATCH_HOME           where to install it       (default /tmp/depwatch)
#   REPORT                  where to write the JSON   (default ./depwatch.json)
#   CHART                   where to write the SVG    (default unset: no chart)
#   FAIL_ON_THRESHOLD       false to warn instead of failing (default true)
#
# Exit codes are depwatch's own: 0 clean, 1 a threshold was breached, 2 the
# manifest could not be read. FAIL_ON_THRESHOLD=false softens 1 and deliberately
# not 2 — a broken invocation reporting "no drift" is worse than a red build.

set -eu

MANIFEST="${MANIFEST:-package.json}"
DEPWATCH_REF="${DEPWATCH_REF:-main}"
DEPWATCH_HOME="${DEPWATCH_HOME:-/tmp/depwatch}"
REPORT="${REPORT:-./depwatch.json}"
FAIL_ON_THRESHOLD="${FAIL_ON_THRESHOLD:-true}"
MAX_LIBYEARS="${MAX_LIBYEARS:-}"
MAX_REPLACE="${MAX_REPLACE:-}"
MAX_LIBYEARS_INCREASE="${MAX_LIBYEARS_INCREASE:-}"
BASE_REF="${BASE_REF:-}"
CHART="${CHART:-}"

log() { echo "depwatch-ci: $*" >&2; }

# --- install -----------------------------------------------------------------
# depwatch is not published to npm, so it is built from source. Cloning at a tag
# and building takes a few seconds and pins exactly what runs; on a platform with
# a build cache, cache DEPWATCH_HOME on DEPWATCH_REF.
if [ ! -x "${DEPWATCH_HOME}/dist/cli.js" ] && [ ! -f "${DEPWATCH_HOME}/dist/cli.js" ]; then
  log "installing depwatch@${DEPWATCH_REF} into ${DEPWATCH_HOME}"
  rm -rf "${DEPWATCH_HOME}"
  git clone --quiet --depth 1 --branch "${DEPWATCH_REF}" \
    https://github.com/fabiocicerchia/depwatch.git "${DEPWATCH_HOME}"
  ( cd "${DEPWATCH_HOME}" && npm ci --ignore-scripts --silent && npm run build --silent )
fi

DEPWATCH="node ${DEPWATCH_HOME}/dist/cli.js"

# --- flags -------------------------------------------------------------------
# Kept in a single string rather than an array: POSIX sh has no arrays, and none
# of these values contain whitespace.
FLAGS=""
[ -n "${ECO:-}" ] && FLAGS="${FLAGS} --eco ${ECO}"
[ -n "${STALE:-}" ] && FLAGS="${FLAGS} --stale ${STALE}"
[ -n "${RISKY:-}" ] && FLAGS="${FLAGS} --risky ${RISKY}"
[ "${TRANSITIVE:-false}" = "true" ] && FLAGS="${FLAGS} --transitive"
[ "${NO_LOCK:-false}" = "true" ] && FLAGS="${FLAGS} --no-lock"

GATES=""
[ -n "${MAX_LIBYEARS}" ] && GATES="${GATES} --max-libyears ${MAX_LIBYEARS}"
[ -n "${MAX_REPLACE}" ] && GATES="${GATES} --max-replace ${MAX_REPLACE}"

# --- the ratchet -------------------------------------------------------------
# Measure BASE_REF the same way and let depwatch compare the totals. This is the
# gate worth having on a repository that is already behind: an absolute budget
# set above today's figure never fires, and one set below it fails every change
# for debt that change did not create.
if [ -n "${MAX_LIBYEARS_INCREASE}" ]; then
  if [ -z "${BASE_REF}" ]; then
    log "no BASE_REF to compare against — the ratchet is skipped"
  elif ! git rev-parse --git-dir >/dev/null 2>&1; then
    log "not a git checkout — the ratchet is skipped"
  else
    PREFIX="$(git rev-parse --show-prefix)"
    WORK="$(mktemp -d)/base"
    BASELINE="$(mktemp -d)/baseline.json"

    # Most CI clones are shallow, so the base commit is usually not present.
    if git fetch --no-tags --depth=1 origin "${BASE_REF}" >/dev/null 2>&1 &&
       git worktree add --detach "${WORK}" FETCH_HEAD >/dev/null 2>&1; then
      if [ -e "${WORK}/${PREFIX}${MANIFEST}" ]; then
        # No --deep for the baseline: the ratchet compares total drift, which the
        # maintainer and archived signals do not feed into.
        if $DEPWATCH check "${WORK}/${PREFIX}${MANIFEST}" --json --out "${BASELINE}" $FLAGS; then
          GATES="${GATES} --max-libyears-increase ${MAX_LIBYEARS_INCREASE} --baseline ${BASELINE}"
          log "${BASE_REF} measures $(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).totalLibyears.toFixed(2)))' "${BASELINE}") libyears"
        else
          log "could not measure ${BASE_REF} — the ratchet is skipped"
        fi
      else
        log "${MANIFEST} does not exist on ${BASE_REF} — the ratchet is skipped"
      fi
      git worktree remove --force "${WORK}" >/dev/null 2>&1 || true
    else
      log "could not fetch ${BASE_REF} — the ratchet is skipped"
    fi
  fi
fi

[ -n "${GATES}" ] && GATES="--ci ${GATES}"

# --- measure -----------------------------------------------------------------
# The human-readable table first, then the same analysis as JSON for whatever
# the platform does with artifacts. Two runs, but the registry client caches, so
# the second costs no requests.
CODE=0
# shellcheck disable=SC2086  # word splitting is how the flags are assembled
$DEPWATCH check "${MANIFEST}" $FLAGS $GATES || CODE=$?
# shellcheck disable=SC2086
$DEPWATCH check "${MANIFEST}" --json --out "${REPORT}" $FLAGS >/dev/null 2>&1 || true

if [ -n "${CHART}" ]; then
  # shellcheck disable=SC2086
  $DEPWATCH chart "${MANIFEST}" --out "${CHART}" $FLAGS || log "could not write ${CHART}"
fi

if [ "${CODE}" -ne 0 ] && [ "${CODE}" -ne 1 ]; then
  log "could not measure ${MANIFEST}"
  exit "${CODE}"
fi

if [ "${CODE}" -ne 0 ] && [ "${FAIL_ON_THRESHOLD}" != "true" ]; then
  log "threshold breached (FAIL_ON_THRESHOLD is false)"
  exit 0
fi

exit "${CODE}"
