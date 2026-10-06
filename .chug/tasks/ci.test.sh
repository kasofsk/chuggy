#!/bin/sh
# Shell test for ci.sh — the sequencer's own behaviour, not the gates'.
#
# Cases run against throwaway repos holding stub gates with controllable exit
# codes: what is under test is how ci.sh *treats* a verdict — that a finding
# and a could-not-run stay different answers all the way to its own exit code,
# and that the only time bound on the suites is each one's own cap.
#
# The fixture carries a stub for every gate the sequencer names, because a
# named gate that is absent is itself a could-not-run. A fixture short of one
# would exercise that rather than the case it was written for.
#
# Run:  .chug/tasks/ci.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/ci.sh"
SELECT="$HERE/_ci-select.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"

# No case inherits a sequencer input it did not choose. ci.sh hands each suite
# the environment it was given, so an ambient one reaches the nested runs below
# and answers a question the case did not ask. These are ci.sh's own Env block
# and the base `_ci-select.sh` reads, less CHUG_CI_SHELL_SUITES — the recursion
# guard, which each case that reaches the suite stage sets for itself.
unset CHUG_CI_FULL CHUG_CI_BASE GITHUB_BASE_REF CHUG_CI_SUITE_TIMEOUT_SECS

ROOT="$(cd "$HERE/../.." && pwd)"
grep -F '    ./.chug/tasks/ci.sh' "$ROOT/justfile" >/dev/null
grep -F '    CHUG_CI_FULL=1 ./.chug/tasks/ci.sh' "$ROOT/justfile" >/dev/null

# Read off the sequencer rather than listed here: the roster is the calls, and
# a second copy of it would be the half that drifts.
named_gates() { # <script> — the gates it calls, by bare name
	grep -o '\./\.chug/tasks/[a-z-]*\.sh' "$1" | sed 's|.*/||; s|\.sh$||'
}

# An empty roster would leave every case below passing against a repo with no
# gates at all — the exact reading this suite exists to refuse.
if [ -z "$(named_gates "$SUT")" ]; then
	echo "ci.test.sh: no gate calls found in $SUT; the fixture would stub nothing"
	exit 2
fi

stub_repo() { # <doc-lint exit> — every named gate stubbed clean but doc-lint
	fresh_repo "$R"
	mkdir -p "$R/.chug/tasks"
	cp "$SUT" "$R/.chug/tasks/ci.sh"
	cp "$SELECT" "$R/.chug/tasks/_ci-select.sh"
	chmod +x "$R/.chug/tasks/ci.sh"
	for gate in $(named_gates "$SUT"); do
		printf '#!/bin/sh\necho stub %s\nexit 0\n' "$gate" > "$R/.chug/tasks/$gate.sh"
		chmod +x "$R/.chug/tasks/$gate.sh"
	done
	printf '#!/bin/sh\necho stub doc-lint\nexit %s\n' "$1" > "$R/.chug/tasks/doc-lint.sh"
	chmod +x "$R/.chug/tasks/doc-lint.sh"
	git -C "$R" add -A
}

# The gate stage alone: with the suite stage on, the fixture's empty suite glob
# would add a second could-not-run and the counts below would stop being about
# the roster.
run_gates_only() {
	OUT="$WORK/.out"
	set +e
	(cd "$R" && CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
	RC=$?
	set -e
}

# The real ci.sh hands every suite CHUG_CI_SHELL_SUITES=0 so this file cannot
# recurse into a live run. That guard is inherited here and would skip the
# suite stage in the cases that exist to exercise it, so they set it back
# explicitly; recursion stays bounded because the stub ci.sh under test passes
# the guard down to its own stub suites.
run_ci() {
	OUT="$WORK/.out"
	set +e
	(cd "$R" && CHUG_CI_SHELL_SUITES=1 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
	RC=$?
	set -e
}

# The last commit as the whole change, through the gate stage alone.
commit_all() { # <message>
	git -C "$R" add -A
	git -C "$R" commit -qm "$1"
}
run_last_commit() { # [1 to run the suite stage too]
	OUT="$WORK/.out"
	set +e
	(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES="${1:-0}" ./.chug/tasks/ci.sh) >"$OUT" 2>&1
	RC=$?
	set -e
}

stub_repo 0
git -C "$R" commit -qm baseline
printf '# a page\n' > "$R/PAGE.md"
run_gates_only
check "all gates clean exits 0" 0 "$RC" "all gates clean"
check "CHUG_CI_SHELL_SUITES=0 skips the suite stage" 0 "$RC" "SKIPPED"
check "the default run uses change selection" 0 "$RC" "changed run"

stub_repo 0
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_FULL=1 CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "CHUG_CI_FULL forces every gate" 0 "$RC" "full run (CHUG_CI_FULL=1)"
check "the forced run executes the model gate" 0 "$RC" "stub check-model"

# A resolved base activates selection. Documentation does not reach the model,
# database or source toolchains, and each skip is stated rather than hidden.
stub_repo 0
git -C "$R" commit -qm baseline
printf '# docs\n' > "$R/README.md"
git -C "$R" add README.md
git -C "$R" commit -qm docs
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a resolved base activates a changed run" 0 "$RC" "changed run"
check "a docs-only change skips the model" 0 "$RC" "check-model: SKIPPED"
check "a docs-only change still runs doc-lint" 0 "$RC" "stub doc-lint"

stub_repo 0
mkdir -p "$R/src/domain"
printf 'export const changed = true;\n' > "$R/src/domain/changed.ts"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf 'export const changed = false;\n' > "$R/src/domain/changed.ts"
git -C "$R" add -A
git -C "$R" commit -qm source
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a source-only change skips Quint" 0 "$RC" "check-model: SKIPPED"
check "a source-only change selects static checks" 0 "$RC" "stub check-source"
refute "a source-only change runs the suites" 0 "$RC" "check-source unit: SKIPPED"

# THE SUITES UNDER `test/` ARE WHAT HOLDS `scripts/` ANSWERABLE, and a change
# to a script reaches them only if the unit stage is selected for it. A cone
# that omits `scripts/**` lets a change to a checking script skip the suite
# written to hold that script.
stub_repo 0
mkdir -p "$R/scripts"
printf 'export const before = 1;\n' > "$R/scripts/check-something.ts"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf 'export const after = 2;\n' > "$R/scripts/check-something.ts"
git -C "$R" add -A
git -C "$R" commit -qm script
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
refute "a script-only change runs the suites, not just the static checks" 0 "$RC" "check-source unit: SKIPPED"
check "a script-only change still skips Quint" 0 "$RC" "check-model: SKIPPED"

# The contract's package is emitted under its own tsconfig, which only a unit
# suite reads, so a change to that file alone must select the unit stage.
stub_repo 0
printf '{}\n' > "$R/tsconfig.contract-pack.json"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf '{ "include": [] }\n' > "$R/tsconfig.contract-pack.json"
git -C "$R" add -A
git -C "$R" commit -qm pack
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
refute "a change to the pack's tsconfig runs the suites" 0 "$RC" "check-source unit: SKIPPED"
check "a change to the pack's tsconfig still skips Quint" 0 "$RC" "check-model: SKIPPED"

# The contract's history names the releases the unit suites replay against the
# server, so a change to that file alone must select the unit stage.
stub_repo 0
mkdir -p "$R/test/contract"
printf '[]\n' > "$R/test/contract/workerContract.history.json"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf '[{}]\n' > "$R/test/contract/workerContract.history.json"
git -C "$R" add -A
git -C "$R" commit -qm history
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
refute "a change to the contract's history runs the suites" 0 "$RC" "check-source unit: SKIPPED"

# The worker image's pin is read by a unit suite that holds it to the planes'
# accepted range, and a bump moves that file and nothing else, so a change to
# it alone must select the unit stage.
stub_repo 0
mkdir -p "$R/images/worker"
printf '{ "contractRelease": "1.0.0" }\n' > "$R/images/worker/core.json"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf '{ "contractRelease": "1.1.0" }\n' > "$R/images/worker/core.json"
git -C "$R" add -A
git -C "$R" commit -qm bump
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
refute "a bump of the worker image's pin runs the suites" 0 "$RC" "check-source unit: SKIPPED"

# The repository's own declarations are read as files by the console's view
# suites and by unit suites alike, and a declaration changes with nothing else
# beside it, so a change to one alone must select both.
stub_repo 0
mkdir -p "$R/.chug/configurations"
printf '{}\n' > "$R/.chug/configurations/basic.json"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf '{ "version": 1 }\n' > "$R/.chug/configurations/basic.json"
git -C "$R" add -A
git -C "$R" commit -qm declaration
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a change to a declared configuration runs the console suites" 0 "$RC" "stub check-console"
refute "a change to a declared configuration runs the unit suites" 0 "$RC" "check-source unit: SKIPPED"

# `check-keto`'s end-to-end suite composes the boundary over the postgres
# harnesses, so a cone naming only the Keto adapter leaves the one suite that
# proves a derived owner against a real authority unrun on a changed run.
stub_repo 0
mkdir -p "$R/test/postgres"
printf 'export const before = 1;\n' > "$R/test/postgres/threadHarness.ts"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf 'export const after = 2;\n' > "$R/test/postgres/threadHarness.ts"
git -C "$R" add -A
git -C "$R" commit -qm harness
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a postgres harness change selects the authority gate" 0 "$RC" "stub check-keto"

stub_repo 0
mkdir -p "$R/model"
printf 'module before {}\n' > "$R/model/domain.qnt"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf 'module after {}\n' > "$R/model/domain.qnt"
git -C "$R" add -A
git -C "$R" commit -qm model
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
refute "a model change selects Quint" 0 "$RC" "check-model: SKIPPED"
check "a model change selects model API generation" 0 "$RC" "stub check-model-api"

# A PAGE KEPT BESIDE THE CODE IS NOT THE CODE. The gates that prove something
# of a directory select on the directory, and a page in it is read by none of
# them, so a changed page under the model or the sources selects the gates
# that read text and nothing slower. The console's build is the one that
# reads a page: it takes the names of classes from every file under it.
stub_repo 0
mkdir -p "$R/model" "$R/src/adapters/postgres" "$R/ui/chuggy-ui/dev"
printf 'module model {}\n' > "$R/model/domain.qnt"
printf '# before\n' > "$R/model/AGENTS.md"
printf '# before\n' > "$R/src/adapters/postgres/AGENTS.md"
printf '# before\n' > "$R/ui/chuggy-ui/dev/README.md"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf '# after\n' > "$R/model/AGENTS.md"
printf '# after\n' > "$R/src/adapters/postgres/AGENTS.md"
printf '# after\n' > "$R/ui/chuggy-ui/dev/README.md"
git -C "$R" add -A
git -C "$R" commit -qm pages
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a page under the model skips Quint" 0 "$RC" "check-model: SKIPPED"
check "a page under the model skips model API generation" 0 "$RC" "check-model-api: SKIPPED"
check "a page under the sources skips the suites" 0 "$RC" "check-source unit: SKIPPED"
check "a page under the sources skips the database" 0 "$RC" "check-postgres: SKIPPED"
check "a page under the sources skips the query check" 0 "$RC" "check-queries: SKIPPED"
check "a page under the sources skips the authority" 0 "$RC" "check-keto: SKIPPED"
refute "a page under the console selects the console, whose build reads it" 0 "$RC" "check-console: SKIPPED"
check "a page beside the code still runs doc-lint" 0 "$RC" "stub doc-lint"

# A page changed with the code beside it hides none of the code: the cone is
# asked of what is left once the pages are set aside, not of nothing.
printf 'module changed {}\n' > "$R/model/domain.qnt"
printf '# again\n' > "$R/model/AGENTS.md"
git -C "$R" add -A
git -C "$R" commit -qm model-and-page
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
refute "a model change beside a changed page selects Quint" 0 "$RC" "check-model: SKIPPED"
check "a model change beside a changed page still skips the database" 0 "$RC" "check-postgres: SKIPPED"

# A file is a page by its last suffix alone: one that only carries the letters
# is code, and one kept under the replayed corpus is still a page.
stub_repo 0
mkdir -p "$R/src/domain" "$R/test/conformance" "$R/test/random"
printf 'export const before = 1;\n' > "$R/src/domain/notes.md.ts"
printf '# before\n' > "$R/test/conformance/README.md"
printf '# before\n' > "$R/test/random/README.md"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf '# after\n' > "$R/test/conformance/README.md"
printf '# after\n' > "$R/test/random/README.md"
git -C "$R" add -A
git -C "$R" commit -qm corpus-pages
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a page under the replayed corpus skips conformance" 0 "$RC" "check-conformance: SKIPPED"
check "a page under the random walks skips them" 0 "$RC" "check-random: SKIPPED"
printf 'export const after = 2;\n' > "$R/src/domain/notes.md.ts"
git -C "$R" add -A
git -C "$R" commit -qm code-named-like-a-page
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "code whose name only carries a page's suffix selects conformance" 0 "$RC" "stub check-conformance"
refute "code whose name only carries a page's suffix selects the suites" 0 "$RC" "check-source unit: SKIPPED"

# A PAGE A SUITE READS IS ASKED FOR BY NAME. The unit suites hold the runbook's
# table to the API's root, so that page selects them and no other code gate.
stub_repo 0
mkdir -p "$R/deploy/rig/images"
printf '# before\n' > "$R/deploy/rig/images/README.md"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf '# after\n' > "$R/deploy/rig/images/README.md"
git -C "$R" add -A
git -C "$R" commit -qm runbook
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "the runbook's page selects the suites that read it" 0 "$RC" "stub check-source"
check "the runbook's page skips the database" 0 "$RC" "check-postgres: SKIPPED"

# The action directory's page is asked for the same way: the unit suites put
# the example it gives through the importer.
stub_repo 0
mkdir -p "$R/.chug/actions"
printf '# before\n' > "$R/.chug/actions/README.md"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf '# after\n' > "$R/.chug/actions/README.md"
git -C "$R" add -A
git -C "$R" commit -qm actions
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "the action directory's page selects the suites that read it" 0 "$RC" "stub check-source"
check "the action directory's page skips the database" 0 "$RC" "check-postgres: SKIPPED"

# So is a document in it: the unit suites put every action this repository
# declares through the importer.
stub_repo 0
mkdir -p "$R/.chug/actions"
printf '{"before": 1}\n' > "$R/.chug/actions/build.json"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf '{"after": 1}\n' > "$R/.chug/actions/build.json"
git -C "$R" add -A
git -C "$R" commit -qm actions
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
refute "an action's document selects the suites that read it" 0 "$RC" "check-source unit: SKIPPED"
check "an action's document skips the database" 0 "$RC" "check-postgres: SKIPPED"

# The vendored package is the model's text and the corpus the harness replays,
# so a change to it reaches the replay gates and the pin, not only Quint.
stub_repo 0
mkdir -p "$R/model/ticket-domain/evaluation"
printf 'module before {}\n' > "$R/model/ticket-domain/evaluation/evaluation.qnt"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf 'module after {}\n' > "$R/model/ticket-domain/evaluation/evaluation.qnt"
git -C "$R" add -A
git -C "$R" commit -qm vendored
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a vendored change selects the pin" 0 "$RC" "stub check-vendored"
check "a vendored change selects conformance" 0 "$RC" "stub check-conformance"
check "a vendored change selects the random replay" 0 "$RC" "stub check-random"

# A PATH THAT WENT AWAY IS A PATH THAT CHANGED: a deletion selects what read
# the file, whether committed, staged or only left in the tree, a rename
# selects by the name it left as well as the one it took, and a name git
# writes in octal is read as it is spelled.
stub_repo 0
mkdir -p "$R/src/domain" "$R/notes" "$R/deploy/rig"
printf 'kind: Probe\n' > "$R/deploy/rig/probe.yaml"
printf 'export const here = 1;\n' > "$R/src/domain/gone.ts"
printf 'export const kept = 1;\n' > "$R/src/domain/moved.ts"
commit_all baseline
git -C "$R" rm -q src/domain/gone.ts
commit_all deletion
run_last_commit
check "a deleted source selects the database" 0 "$RC" "stub check-postgres"
refute "a deleted source selects the suites" 0 "$RC" "check-source unit: SKIPPED"
git -C "$R" mv src/domain/moved.ts notes/moved.txt
commit_all rename
run_last_commit
check "a file renamed out of the sources selects by the name it left" 0 "$RC" "stub check-postgres"
printf 'export const spelled = 1;\n' > "$R/src/domain/$(printf 'caf\303\251').ts"
commit_all accented
run_last_commit
check "a source whose name git would quote selects the database" 0 "$RC" "stub check-postgres"
git -C "$R" rm -q deploy/rig/probe.yaml
commit_all manifest-gone
run_last_commit
check "a deleted manifest selects the gate that resolves what pages name" 0 "$RC" "stub check-paths"
rm "$R/notes/moved.txt"
run_gates_only
check "a deletion left in the tree selects the paths gate" 0 "$RC" "stub check-paths"
git -C "$R" rm -q notes/moved.txt
run_gates_only
check "a staged deletion selects the paths gate" 0 "$RC" "stub check-paths"

# A NAME THAT IS NOT A LINE SELECTS EVERYTHING: git writes it in quotes, which
# no pattern reads.
stub_repo 0
mkdir -p "$R/src/domain"
commit_all baseline
printf 'export const tabbed = 1;\n' > "$R/src/domain/$(printf 'tab\there').ts"
commit_all tabbed
run_last_commit
check "a change whose name holds a tab is run in full" 0 "$RC" "full run (a changed path's name cannot be read as a line)"
refute "the full run reaches Quint" 0 "$RC" "check-model: SKIPPED"

# A SUITE'S INPUT OUTSIDE THE SOURCES IS IN ITS GATE'S CONE. The unit suites
# read the roles file, the model's text and one gate's script; the database
# and authority suites read the wipe and import helpers from all over the
# tests; the replays read the directed model.
stub_repo 0
mkdir -p "$R/deploy/rig/postgres" "$R/model/mc" "$R/test/actor"
printf 'export const harness = 1;\n' > "$R/test/actor/harness.ts"
printf 'module directed {}\n' > "$R/model/mc/mc_chuggy_directed.qnt"
printf -- '-- roles\n' > "$R/deploy/rig/postgres/postgres-roles.sql"
printf -- '-- wipe\n' > "$R/deploy/rig/wipe-tickets.sql"
printf 'module runner {}\n' > "$R/model/runner.qnt"
commit_all baseline
printf -- '-- roles, changed\n' > "$R/deploy/rig/postgres/postgres-roles.sql"
commit_all roles
run_last_commit
refute "the roles file selects the suites that read it" 0 "$RC" "check-source unit: SKIPPED"
check "the roles file skips the database" 0 "$RC" "check-postgres: SKIPPED"
printf -- '-- wipe, changed\n' > "$R/deploy/rig/wipe-tickets.sql"
commit_all wipe
run_last_commit
check "the wipe selects the database suites that read it" 0 "$RC" "stub check-postgres"
printf 'module runner { val changed = 1 }\n' > "$R/model/runner.qnt"
commit_all model
run_last_commit
refute "the model's text selects the suites that read it" 0 "$RC" "check-source unit: SKIPPED"
printf '#!/bin/sh\necho stub check-console-sheets, changed\nexit 0\n' > "$R/.chug/tasks/check-console-sheets.sh"
commit_all sheets
run_last_commit
refute "the console sheets' gate selects the suite that reads it" 0 "$RC" "check-source unit: SKIPPED"
printf 'export const harness = 2;\n' > "$R/test/actor/harness.ts"
commit_all helper
run_last_commit
check "a helper the database suites import selects them" 0 "$RC" "stub check-postgres"
check "a helper the authority's suites import selects them" 0 "$RC" "stub check-keto"
printf 'module directed { val changed = 1 }\n' > "$R/model/mc/mc_chuggy_directed.qnt"
commit_all directed
run_last_commit
check "the directed model selects the replay that reads it" 0 "$RC" "stub check-conformance"
check "the directed model selects the random replay" 0 "$RC" "stub check-random"

# The console is a workspace the root lockfile pins, and what Prettier leaves
# out is part of what it checks.
stub_repo 0
printf '{}\n' > "$R/package-lock.json"
printf 'model/\n' > "$R/.prettierignore"
commit_all baseline
printf '{ "lockfileVersion": 3 }\n' > "$R/package-lock.json"
commit_all lock
run_last_commit
refute "a lockfile change selects the console" 0 "$RC" "check-console: SKIPPED"
printf '{ "private": true }\n' > "$R/package.json"
commit_all manifest
run_last_commit
refute "a package manifest change selects the console" 0 "$RC" "check-console: SKIPPED"
printf 'dist/\n' > "$R/.prettierignore"
commit_all ignore
run_last_commit
refute "what Prettier leaves out selects the static checks" 0 "$RC" "check-source static: SKIPPED"

# A GATE THAT READS THE TREE AS TEXT RUNS ON ANY CHANGE, and the static checks
# on any change but a page's: a sheet outside the console is a kind none of
# their old lists of suffixes held.
text_gates="doc-lint check-figures check-paths check-shell-quoting check-console-sheets check-gates check-comments check-knowledge check-vendored"
stub_repo 0
mkdir -p "$R/notes"
commit_all baseline
printf 'body { margin: 0 }\n' > "$R/notes/site.css"
commit_all sheet
run_last_commit
for gate in $text_gates; do
	refute "a sheet outside the console selects $gate" 0 "$RC" "$gate: SKIPPED"
done
refute "a sheet outside the console selects the static checks" 0 "$RC" "check-source static: SKIPPED"
refute "a sheet outside the console selects the clone detector" 0 "$RC" "check-duplication: SKIPPED"
check "a sheet outside the console skips the suites" 0 "$RC" "check-source unit: SKIPPED"
printf '# a page\n' > "$R/notes/PAGE.md"
commit_all page
run_last_commit
for gate in $text_gates; do
	refute "a page selects $gate" 0 "$RC" "$gate: SKIPPED"
done
check "a page skips the static checks" 0 "$RC" "check-source static: SKIPPED"
check "a page skips the clone detector" 0 "$RC" "check-duplication: SKIPPED"

# The boundary gate walks directories, so a module of a kind its old list of
# suffixes left out is in its cone, and the generated API's gate holds both
# files its generator writes.
stub_repo 0
mkdir -p "$R/scripts" "$R/src/domain/generated"
printf 'export type Entry = 1;\n' > "$R/src/domain/generated/modelTypes.ts"
commit_all baseline
printf 'export const answer = 42;\n' > "$R/scripts/orphan.js"
commit_all orphan
run_last_commit
check "a script the boundary gate walks selects it" 0 "$RC" "stub check-boundaries"
check "a script leaves the console alone" 0 "$RC" "check-console: SKIPPED"
mkdir -p "$R/test" "$R/ui/chuggy-ui"
printf 'export const helper = 1;\n' > "$R/test/helper.cjs"
commit_all helper
run_last_commit
check "a test module the boundary gate walks selects it" 0 "$RC" "stub check-boundaries"
printf 'export default {};\n' > "$R/ui/chuggy-ui/settings.mjs"
commit_all settings
run_last_commit
check "a console module the boundary gate walks selects it" 0 "$RC" "stub check-boundaries"
printf 'dist/\n' > "$R/.gitignore"
commit_all ignored
run_last_commit
refute "what the tree ignores selects the console, whose build leaves it out" 0 "$RC" "check-console: SKIPPED"
printf 'export type Entry = 2;\n' > "$R/src/domain/generated/modelTypes.ts"
commit_all types
run_last_commit
refute "the generated types select the gate that regenerates them" 0 "$RC" "check-model-api: SKIPPED"

# The replays read the model's generated API through the vocabulary they
# share, and the query check types every source the adapter's reach.
stub_repo 0
mkdir -p "$R/src/generated" "$R/src/contract"
printf 'export const api = 1;\n' > "$R/src/generated/model-api.ts"
printf 'export const wire = 1;\n' > "$R/src/contract/http.ts"
commit_all baseline
printf 'export const api = 2;\n' > "$R/src/generated/model-api.ts"
commit_all generated
run_last_commit
check "the generated API selects the replay that reads it" 0 "$RC" "stub check-conformance"
check "the generated API selects the random replay" 0 "$RC" "stub check-random"
refute "the generated API selects the gate that regenerates it" 0 "$RC" "check-model-api: SKIPPED"
printf 'export const wire = 2;\n' > "$R/src/contract/http.ts"
commit_all contract
run_last_commit
check "a source outside the adapters selects the query check" 0 "$RC" "stub check-queries"

# A SUITE THAT RUNS ITS GATE OVER THE TREE ITSELF IS SELECTED WITH THE GATE.
stub_repo 0
mkdir -p "$R/src/domain" "$R/scripts" "$R/model/mc"
for suite in check-conformance check-random check-model-api emit-goldens check-postgres; do
	printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/$suite.test.sh"
done
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/emit-goldens.sh"
printf '# harness\n' > "$R/.chug/tasks/_suite.sh"
printf 'export const decide = 1;\n' > "$R/src/domain/deciders.ts"
printf 'export const generate = 1;\n' > "$R/scripts/generate-model-api.ts"
printf 'module mc {}\n' > "$R/model/mc/mc_chuggy.qnt"
commit_all baseline
printf 'export const decide = 2;\n' > "$R/src/domain/deciders.ts"
commit_all decider
run_last_commit 1
check "a decider selects the replay's suite" 0 "$RC" "  - .chug/tasks/check-conformance.test.sh"
check "a decider selects the random replay's suite" 0 "$RC" "  - .chug/tasks/check-random.test.sh"
refute "a decider leaves a suite of fixtures alone" 0 "$RC" "  - .chug/tasks/check-postgres.test.sh"
refute "a decider leaves the emitter's suite alone" 0 "$RC" "  - .chug/tasks/emit-goldens.test.sh"
printf 'export const generate = 2;\n' > "$R/scripts/generate-model-api.ts"
commit_all generator
run_last_commit 1
check "the generator selects the generated API's suite" 0 "$RC" "  - .chug/tasks/check-model-api.test.sh"
refute "the generator leaves the replay's suite alone" 0 "$RC" "  - .chug/tasks/check-conformance.test.sh"
printf 'module mc { val changed = 1 }\n' > "$R/model/mc/mc_chuggy.qnt"
commit_all walked
run_last_commit 1
check "the model selects the emitter's suite" 0 "$RC" "  - .chug/tasks/emit-goldens.test.sh"
printf '#!/bin/sh\nexit 0\n# changed\n' > "$R/.chug/tasks/emit-goldens.sh"
commit_all emitter
run_last_commit 1
check "the emitter selects its suite" 0 "$RC" "  - .chug/tasks/emit-goldens.test.sh"
printf '# harness, changed\n' > "$R/.chug/tasks/_suite.sh"
commit_all harness
run_last_commit 1
check "the harness selects a suite that runs over the tree" 0 "$RC" "  - .chug/tasks/check-random.test.sh"
check "the harness selects the emitter's suite" 0 "$RC" "  - .chug/tasks/emit-goldens.test.sh"
printf '#!/bin/sh\necho stub check-postgres\nexit 0\n# changed\n' > "$R/.chug/tasks/check-postgres.sh"
commit_all gate
run_last_commit 1
check "a gate selects its suite of fixtures" 0 "$RC" "  - .chug/tasks/check-postgres.test.sh"

# A SUITE THAT READS A FILE BESIDE ITS GATE IS SELECTED BY IT: this suite holds
# the justfile to the sequencer, three gates' suites run their gate over the
# tree's own configuration of its tools, and a suite kept beside what it
# proves shares the harness.
stub_repo 0
mkdir -p "$R/.githooks" "$R/deploy/rig"
for suite in .chug/tasks/ci .chug/tasks/check-source .chug/tasks/check-boundaries \
	.chug/tasks/check-duplication .githooks/pre-commit deploy/rig/drill; do
	printf '#!/bin/sh\nexit 0\n' > "$R/$suite.test.sh"
done
printf '#!/bin/sh\nexit 0\n' > "$R/.githooks/pre-commit"
printf '#!/bin/sh\nexit 0\n' > "$R/deploy/rig/drill.sh"
printf 'model/\n' > "$R/.prettierignore"
printf '# harness\n' > "$R/.chug/tasks/_suite.sh"
printf 'module.exports = {};\n' > "$R/.dependency-cruiser.cjs"
printf '{}\n' > "$R/tsconfig.contract.json"
printf '{}\n' > "$R/.jscpd.json"
printf 'check:\n    ./.chug/tasks/ci.sh\n' > "$R/justfile"
printf 'export default [];\n' > "$R/eslint.config.js"
commit_all baseline
printf 'module.exports = { forbidden: [] };\n' > "$R/.dependency-cruiser.cjs"
commit_all boundaries
run_last_commit 1
check "the boundary rules select the suite that copies them" 0 "$RC" "  - .chug/tasks/check-boundaries.test.sh"
printf '{ "include": [] }\n' > "$R/tsconfig.contract.json"
commit_all browser
run_last_commit 1
check "the browser's compiler settings select the suite that copies them" 0 "$RC" "  - .chug/tasks/check-source.test.sh"
printf '{ "ignore": [] }\n' > "$R/.jscpd.json"
commit_all clones
run_last_commit 1
check "the clone detector's settings select the suite that copies them" 0 "$RC" "  - .chug/tasks/check-duplication.test.sh"
printf '# harness, changed\n' > "$R/.chug/tasks/_suite.sh"
commit_all harness
run_last_commit 1
check "the harness selects the hook's suite" 0 "$RC" "  - .githooks/pre-commit.test.sh"
check "the harness selects a suite kept beside its script" 0 "$RC" "  - deploy/rig/drill.test.sh"
check "the harness selects the sequencer's suite" 0 "$RC" "  - .chug/tasks/ci.test.sh"
check "the harness selects a suite that copies the tools' configuration" 0 "$RC" "  - .chug/tasks/check-boundaries.test.sh"
printf 'dist/\n' > "$R/.prettierignore"
commit_all ignored
run_last_commit 1
check "what the formatter leaves out selects the suite that copies it" 0 "$RC" "  - .chug/tasks/check-source.test.sh"
printf '#!/bin/sh\necho stub check-duplication\nexit 0\n# changed\n' > "$R/.chug/tasks/check-duplication.sh"
commit_all detector
run_last_commit 1
check "a gate selects its suite that copies the tools' configuration" 0 "$RC" "  - .chug/tasks/check-duplication.test.sh"
printf '#!/bin/sh\nexit 0\n# changed\n' > "$R/.githooks/pre-commit"
commit_all hook
run_last_commit 1
check "the hook selects its suite" 0 "$RC" "  - .githooks/pre-commit.test.sh"
printf '#!/bin/sh\nexit 0\n# changed\n' > "$R/deploy/rig/drill.sh"
commit_all script
run_last_commit 1
check "a script selects the suite kept beside it" 0 "$RC" "  - deploy/rig/drill.test.sh"
printf '\n# changed\n' >> "$R/.chug/tasks/ci.sh"
commit_all sequencer
run_last_commit 1
check "the sequencer selects its suite" 0 "$RC" "  - .chug/tasks/ci.test.sh"
printf 'check:\n    true\n' > "$R/justfile"
commit_all recipe
run_last_commit 1
check "the justfile selects the sequencer's suite" 0 "$RC" "  - .chug/tasks/ci.test.sh"
printf 'export default [{}];\n' > "$R/eslint.config.js"
commit_all rules
run_last_commit 1
check "the lint rules select the suite that proves them" 0 "$RC" "  - .chug/tasks/check-source.test.sh"

# THE MODEL'S GATE FOLLOWS QUINT: a package change that names no quint line
# leaves it out, and one that moves quint's own line brings it in.
package_at() { # <quint version> <other version>
	printf '{\n  "devDependencies": {\n    "@informalsystems/quint": "%s",\n    "left-pad": "%s"\n  }\n}\n' "$1" "$2" > "$R/package.json"
}
stub_repo 0
package_at 0.32.0 1.0.0
commit_all baseline
package_at 0.32.0 1.0.1
commit_all other-package
run_last_commit
check "a package change that leaves quint alone skips Quint" 0 "$RC" "check-model: SKIPPED"
check "a package change still reaches the model's generated API" 0 "$RC" "stub check-model-api"
package_at 0.33.0 1.0.1
run_last_commit
refute "a quint bump not yet committed selects Quint" 0 "$RC" "check-model: SKIPPED"
commit_all quint
run_last_commit
refute "a package change that moves quint selects Quint" 0 "$RC" "check-model: SKIPPED"
lock_at() { # <quint version>
	printf '{\n  "packages": {\n    "node_modules/@informalsystems/quint": {\n      "resolved": "https://registry.npmjs.org/@informalsystems/quint/-/quint-%s.tgz"\n    }\n  }\n}\n' "$1" > "$R/package-lock.json"
}
lock_at 0.33.0
commit_all lock-baseline
lock_at 0.34.0
commit_all lock-quint
run_last_commit
refute "a lockfile that moves quint selects Quint" 0 "$RC" "check-model: SKIPPED"
git -C "$R" config color.ui always
run_last_commit
refute "a quint bump is read through a git that colours its diffs" 0 "$RC" "check-model: SKIPPED"
git -C "$R" config diff.external "echo rendered"
run_last_commit
refute "a quint bump is read past a diff program of the member's own" 0 "$RC" "check-model: SKIPPED"
git -C "$R" config --unset diff.external
stub_repo 0
commit_all baseline
package_at 0.32.0 1.0.0
run_gates_only
refute "package files git cannot diff select Quint" 0 "$RC" "check-model: SKIPPED"

# A RUN THAT RAN NOTHING SAYS SO.
stub_repo 0
commit_all baseline
run_gates_only
check "a change that selects nothing says nothing ran" 0 "$RC" "no gate selected; nothing ran"
refute "a run of nothing is not called clean" 0 "$RC" "all gates clean"

# An unresolvable base fails open to complete coverage, never to no coverage.
stub_repo 0
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=refs/heads/absent CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "an absent base falls back to a full run" 0 "$RC" "full run"
check "the fallback explains the unresolved base" 0 "$RC" "cannot be resolved"

stub_repo 1
run_gates_only
check "a gate finding exits 1" 1 "$RC" "1 gate(s) failed"

# A gate that could not run exits 2, NOT 1 and never 0.
stub_repo 2
run_gates_only
check "a gate that could not run exits 2" 2 "$RC" "could not run"
check "could-not-run is reported as not a pass" 2 "$RC" "this is not a pass"

# A gate the sequencer names but the tree does not carry is a could-not-run
# too. Guarding the call with `[ -x ]` made this print "all gates clean" having
# never attempted the gate — a not-run that read exactly like a pass.
stub_repo 0
rm -f "$R/.chug/tasks/check-gates.sh"
git -C "$R" add -A
run_gates_only
check "a missing named gate exits 2, not 0" 2 "$RC" "1 gate(s) could not run"
check "the missing gate is named" 2 "$RC" "check-gates.sh is missing"

# The half a diff hides in a mode line.
stub_repo 0
chmod -x "$R/.chug/tasks/check-conformance.sh"
git -C "$R" add -A
run_gates_only
check "a non-executable named gate exits 2, not 0" 2 "$RC" "1 gate(s) could not run"
check "the non-executable gate is named" 2 "$RC" "check-conformance.sh is not executable"

stub_repo 0
printf '#!/bin/sh\nexit 1\n' > "$R/.chug/tasks/failing.test.sh"
chmod +x "$R/.chug/tasks/failing.test.sh"
git -C "$R" add -A
run_ci
check "a failing suite fails the run" 1 "$RC" "failing.test.sh"

stub_repo 0
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/passing.test.sh"
chmod +x "$R/.chug/tasks/passing.test.sh"
git -C "$R" add -A
run_ci
check "a passing suite leaves the run clean" 0 "$RC" "all gates clean"

# The stage has no total: a clock that reads an hour later every time it is
# asked stops no suite, so a slower machine runs them all.
stub_repo 0
for suite in one two; do
	printf '#!/bin/sh\ntouch "%s/ran-%s"\n' "$WORK" "$suite" > "$R/.chug/tasks/$suite.test.sh"
done
mkdir -p "$WORK/clock"
printf '#!/bin/sh\nn="$(cat "%s/hours" 2>/dev/null || echo 0)"\necho $((n + 1)) > "%s/hours"\necho $((n * 3600))\n' \
	"$WORK/clock" "$WORK/clock" > "$WORK/clock/date"
chmod +x "$WORK/clock/date"
git -C "$R" add -A
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$WORK/clock:$PATH" CHUG_CI_SHELL_SUITES=1 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
ls "$WORK" >>"$OUT"
check "hours between suites stop none of them" 0 "$RC" "all gates clean"
check "the first suite ran" 0 "$RC" "ran-one"
check "the last suite ran" 0 "$RC" "ran-two"
check "the stage states the one bound it applies" 0 "$RC" "per suite, no total"

# A suite past its own cap is stopped and fails the run by name.
stub_repo 0
printf '#!/bin/sh\nexec sleep 5\n' > "$R/.chug/tasks/slow.test.sh"
git -C "$R" add -A
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_SHELL_SUITES=1 CHUG_CI_SUITE_TIMEOUT_SECS=1 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a suite past its cap fails the run" 1 "$RC" "slow.test.sh ran past the 1s cap"

# A glob matching nothing must not read as "the suites passed".
stub_repo 0
run_ci
check "no suites found exits 2, not 0" 2 "$RC" "matched nothing"

OUT="$BARE/.out"
set +e
(cd "$BARE" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "ci.test.sh"
