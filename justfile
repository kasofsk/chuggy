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
# Release HEAD to the rig: gate it, build and publish what changed, and open
# the chuggy-fabric pull request that selects it. `just deploy-to-gtr --merge`
# lands that pull request and watches the rollout, and `just deploy-to-gtr
# --console` does both in one run for a release that moves only the console.
# The script's header is the procedure and names what it needs.
deploy-to-gtr *ARGS:
    ./deploy/rig/deploy-to-gtr.sh {{ ARGS }}

# The console of a running installation, served from this machine, so a change
# to it is a reload rather than a release. `ui/chuggy-ui/dev/README.md` is the
# procedure and says which installation it reaches and what that installation
# had to register for it. `just ui-local -d` leaves it running.
ui-local *ARGS:
    CHUG_UI_UID="$(id -u)" CHUG_UI_GID="$(id -g)" \
        docker compose -f ui/chuggy-ui/dev/compose.yaml up {{ ARGS }}

# Install the pre-commit hook. A fresh clone needs this once.
hooks:
    git config core.hooksPath .githooks
    @echo "hooks installed: core.hooksPath = .githooks"
