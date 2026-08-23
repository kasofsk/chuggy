# Thin wrappers. `.chug/tasks/ci.sh` is the real logic — the sequencing has one
# definition, and it is the one the platform will run as a job evaluator later.

# Every gate, in order.
check:
    CHUG_CI_FULL=1 ./.chug/tasks/ci.sh

# The gates' own tests, without the sequencer.
suites:
    #!/bin/sh
    set -eu
    for s in $(git ls-files '*.test.sh'); do
        echo "--- $s"
        CHUG_CI_SHELL_SUITES=0 sh "$s"
    done

# Install the pre-commit hook. A fresh clone needs this once.
hooks:
    git config core.hooksPath .githooks
    @echo "hooks installed: core.hooksPath = .githooks"
