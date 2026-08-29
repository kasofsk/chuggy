# Thin wrappers. `.chug/tasks/ci.sh` is the real logic — the sequencing has one
# definition, and it is the one the platform will run as a job evaluator later.

# Gates whose dependency cone intersects the current change.
check:
    ./.chug/tasks/ci.sh

# Every gate, for release qualification and periodic coverage.
check-full:
    CHUG_CI_FULL=1 ./.chug/tasks/ci.sh

# The gates' own tests, without the sequencer.
suites:
    #!/bin/sh
    set -eu
    for s in $(git ls-files '*.test.sh'); do
        echo "--- $s"
        CHUG_CI_SHELL_SUITES=0 sh "$s"
    done

# The rig acceptance drills, against a live installation. Not in `ci.sh` and not
# in the hook: it needs a running rig, an identity that may read and mutate one
# of its projects, and a browser download, none of which a gate may assume. It
# breaks what it drives, too — it terminates the API's listener and restarts the
# API — so it is asked for by name or not at all.
#
# THE RUNNER'S EXIT IS NOT THE VERDICT. Playwright exits zero on a run whose
# drills all skipped, so the report it wrote is read back afterwards and a drill
# that did not run is a could-not-run like any other gate's.
acceptance *ARGS:
    #!/bin/sh
    set -eu
    missing=""
    for name in CHUG_RIG_CONSOLE_URL CHUG_RIG_API_URL CHUG_RIG_USER \
        CHUG_RIG_PASSWORD CHUG_RIG_TENANT CHUG_RIG_PROJECT CHUG_RIG_SSH; do
        eval "value=\${$name:-}"
        [ -n "$value" ] || missing="$missing $name"
    done
    if [ -n "$missing" ]; then
        echo "acceptance: LINTER ERROR — unset:$missing" >&2
        echo "  Point them at the rig: the console's origin, the API root under" >&2
        echo "  it, an identity holding Read and Mutate on the project, the" >&2
        echo "  tenant and project, and the ssh destination of the cluster." >&2
        echo "  Set CHUG_RIG_EVIDENCE_DIR to collect the screenshots somewhere." >&2
        echo "  Browsers install once: npx playwright install chromium" >&2
        exit 2
    fi
    evidence="${CHUG_RIG_EVIDENCE_DIR:-${TMPDIR:-/tmp}/chuggy-rig-acceptance}"
    CHUG_RIG_EVIDENCE_DIR="$evidence"
    export CHUG_RIG_EVIDENCE_DIR
    rm -f "$evidence/report.json"
    ran=0
    npm run acceptance --workspace test/rig -- {{ ARGS }} || ran=$?
    unreached=0
    node --experimental-strip-types test/rig/verdict.ts \
        "$evidence/report.json" || unreached=$?
    [ "$unreached" -eq 0 ] || exit "$unreached"
    exit "$ran"

# Release HEAD to the rig: gate it, build and publish what changed, and open
# the chuggy-fabric pull request that selects it. `just deploy-to-gtr --merge`
# lands that pull request and watches the rollout. The script's header is the
# procedure and names what it needs.
deploy-to-gtr *ARGS:
    ./deploy/rig/deploy-to-gtr.sh {{ ARGS }}

# Install the pre-commit hook. A fresh clone needs this once.
hooks:
    git config core.hooksPath .githooks
    @echo "hooks installed: core.hooksPath = .githooks"
