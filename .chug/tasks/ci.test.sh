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
IGNORED="$HERE/_ignored-inputs.sh"
INSTALLED="$HERE/_installed-inputs.sh"
PROBED="$HERE/_probed-inputs.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"

# No case inherits a sequencer input it did not choose. ci.sh hands each suite
# the environment it was given, so an ambient one reaches the nested runs below
# and answers a question the case did not ask. These are ci.sh's own Env block
# and the base `_ci-select.sh` reads, less CHUG_CI_SHELL_SUITES — the recursion
# guard, which each case that reaches the suite stage sets for itself.
unset CHUG_CI_ALLOW_UNTRACKED CHUG_CI_FULL CHUG_CI_BASE GITHUB_BASE_REF CHUG_CI_SUITE_TIMEOUT_SECS \
	TRACK_RECORD_TOKEN TRACK_RECORD_TOKEN_FILE TRACK_RECORD_URL TRACK_RECORD_NAMESPACE \
	TRACK_RECORD_FRESH TRACK_RECORD_OFF

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
	cp "$IGNORED" "$R/.chug/tasks/_ignored-inputs.sh"
	cp "$INSTALLED" "$R/.chug/tasks/_installed-inputs.sh"
	cp "$PROBED" "$R/.chug/tasks/_probed-inputs.sh"
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
git -C "$R" add PAGE.md
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

# A catalog's prompt is a markdown file the unit suites import the tree's own
# catalogs through, so a change to one alone must select them although a
# markdown change is otherwise not code.
stub_repo 0
mkdir -p "$R/.chug/prompts"
printf 'Build it.\n' > "$R/.chug/prompts/work.md"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf 'Build it well.\n' > "$R/.chug/prompts/work.md"
git -C "$R" add -A
git -C "$R" commit -qm prompt
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
refute "a change to a catalog's prompt runs the unit suites" 0 "$RC" "check-source unit: SKIPPED"

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

# A LISTING GIT REFUSES SELECTS: a declaration whose pathspec git will not read
# selects its gate, and a change whose tree git cannot read is run in full.
stub_repo 0
mkdir -p "$R/notes/kept"
printf 'a\n' > "$R/notes/kept/x"
sed '/^	check-roster)$/,/;;/ s|^\(		ci_text .*\)$|\1 ":(nosuchmagic)x"|' \
	"$R/.chug/tasks/_ci-select.sh" > "$WORK/.declared"
cat "$WORK/.declared" > "$R/.chug/tasks/_ci-select.sh"
commit_all baseline
printf 'a\n' > "$R/notes/other.txt"
commit_all unrelated
run_last_commit
check "a declaration git cannot list selects its gate" 0 "$RC" "stub check-roster"
printf 'b\n' > "$R/notes/kept/x"
commit_all unreadable
tree="$(git -C "$R" rev-parse HEAD:notes/kept)"
rm "$R/.git/objects/$(printf '%s' "$tree" | cut -c1-2)/$(printf '%s' "$tree" | cut -c3-)"
run_last_commit
check "a change git cannot list is run in full" 0 "$RC" "full run (the change since"

# A WHOLE-TREE GATE IS SELECTED BY WHAT IT DECLARES: its key holds the tree,
# so its pathspecs alone stand between a change and a skipped gate. Each path
# alone selects every such gate that declares it.
stub_repo 0
commit_all baseline
for case in \
	"src/x.ts|check-source unit|check-boundaries" "test/x.ts|check-source unit|check-boundaries" \
	"ui/x.ts|check-source unit|check-boundaries" "scripts/x.ts|check-source unit|check-boundaries" \
	"images/x|check-source unit" "deploy/x.yaml|check-source unit" "model/x.qnt|check-source unit" \
	".chug/configurations/x.json|check-source unit" ".chug/workloads/x.json|check-source unit" \
	".chug/actions/x.json|check-source unit" "tsconfig.contract.json|check-source unit" \
	"tsconfig.contract-pack.json|check-source unit" ".chug/tasks/check-source.sh|check-source unit" \
	".chug/tasks/check-console-sheets.sh|check-source unit" \
	".chug/tasks/_test-timeout.sh|check-source unit" \
	"deploy/rig/images/README.md|check-source unit" ".chug/actions/README.md|check-source unit" \
	".chug/prompts/x.md|check-source unit" ".chug/tasks/review-change.md|check-source unit" \
	".dependency-cruiser.cjs|check-source unit|check-boundaries" \
	".chug/tasks/check-boundaries.sh|check-boundaries" ".chug/tasks/check-roster.sh|check-roster" \
	".claude/settings.json|check-roster"; do
	path="${case%%|*}"
	mkdir -p "$R/$(dirname "$path")"
	printf '# changed\n' >> "$R/$path"
	commit_all "$path"
	run_last_commit
	gates="${case#*|}|"
	while [ -n "$gates" ]; do
		refute "$path selects ${gates%%|*}" 0 "$RC" "${gates%%|*}: SKIPPED"
		gates="${gates#*|}"
	done
done

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

# A lock as npm writes one: quint, a package it depends on and one that
# depends on in turn, the schema library the generated API imports, the
# formatter that writes it, and a package none of the narrow gates reads, each
# at the version named. A fifth word changes what the lock records and not
# what any package gets: `flags` drops the flag npm derives from who asked for
# each, and `hoisted` installs the copy quint's dependency gets under it, a
# copy nothing here asks for taking its place at the root.
lock_json() { # <quint> <grpc> <zod> <left-pad> [flags | hoisted]
	lock_dev=', "dev": true'
	lock_long=node_modules/long
	case "${5:-}" in
	flags) lock_dev="" ;;
	hoisted) lock_long=node_modules/@grpc/grpc-js/node_modules/long ;;
	esac
	printf '{\n  "lockfileVersion": 3,\n  "packages": {\n'
	printf '    "": { "devDependencies": { "@informalsystems/quint": "%s", "zod": "%s", "prettier": "3.0.0", "left-pad": "%s" } },\n' "$1" "$3" "$4"
	printf '    "node_modules/@informalsystems/quint": { "version": "%s", "integrity": "sha512-quint-%s"%s, "dependencies": { "@grpc/grpc-js": "^%s" } },\n' "$1" "$1" "$lock_dev" "$2"
	printf '    "node_modules/@grpc/grpc-js": { "version": "%s", "integrity": "sha512-grpc-%s"%s, "dependencies": { "long": "^5" } },\n' "$2" "$2" "$lock_dev"
	printf '    "%s": { "version": "5.0.0", "integrity": "sha512-long-5"%s },\n' "$lock_long" "$lock_dev"
	if [ "${5:-}" = hoisted ]; then
		printf '    "node_modules/long": { "version": "4.0.0", "integrity": "sha512-long-4"%s },\n' "$lock_dev"
	fi
	printf '    "node_modules/zod": { "version": "%s", "integrity": "sha512-zod-%s"%s },\n' "$3" "$3" "$lock_dev"
	printf '    "node_modules/prettier": { "version": "3.0.0", "integrity": "sha512-prettier-3"%s },\n' "$lock_dev"
	printf '    "node_modules/left-pad": { "version": "%s", "integrity": "sha512-left-pad-%s"%s }\n' "$4" "$4" "$lock_dev"
	printf '  }\n}\n'
}

# The console is a workspace the root lockfile pins, and npm reads every
# workspace's manifest before it runs a script in one. Its format script takes
# Prettier's settings and what Prettier leaves out from the root, and its
# bundler takes the root's compiler settings for the contract it imports. The
# replays run under the module type the nearest manifest above each file
# declares and the schema library the lockfile pins, which the generated API
# imports, and no other package: a lock that moves another leaves them out.
stub_repo 0
mkdir -p "$R/test/rig"
lock_json 0.32.0 1.0.0 4.0.0 1.0.0 > "$R/package-lock.json"
printf 'model/\n' > "$R/.prettierignore"
printf '{}\n' > "$R/.prettierrc.json"
printf '{}\n' > "$R/tsconfig.json"
printf '{}\n' > "$R/test/rig/package.json"
commit_all baseline
lock_json 0.32.0 1.0.0 4.0.0 1.0.1 > "$R/package-lock.json"
commit_all lock
run_last_commit
refute "a lockfile change selects the console" 0 "$RC" "check-console: SKIPPED"
check "a lockfile change the schema library is not in skips the replay" 0 "$RC" "check-conformance: SKIPPED"
check "a lockfile change the schema library is not in skips the random replay" 0 "$RC" "check-random: SKIPPED"
lock_json 0.32.0 1.0.0 4.0.1 1.0.1 > "$R/package-lock.json"
commit_all schema
run_last_commit
check "a lockfile that moves the schema library selects the replay" 0 "$RC" "stub check-conformance"
check "a lockfile that moves the schema library selects the random replay" 0 "$RC" "stub check-random"
printf '{ "private": true }\n' > "$R/package.json"
commit_all manifest
run_last_commit
refute "a package manifest change selects the console" 0 "$RC" "check-console: SKIPPED"
check "a package manifest change selects the replay" 0 "$RC" "stub check-conformance"
check "a package manifest change selects the random replay" 0 "$RC" "stub check-random"
mkdir -p "$R/src"
printf '{ "type": "commonjs" }\n' > "$R/src/package.json"
commit_all nested-manifest
run_last_commit
check "a manifest arriving above the sources selects the replay" 0 "$RC" "stub check-conformance"
check "a manifest arriving above the sources selects the generated API" 0 "$RC" "stub check-model-api"
refute "a manifest arriving above the sources selects the console" 0 "$RC" "check-console: SKIPPED"
check "a manifest is no input of the model's gate" 0 "$RC" "check-model: SKIPPED"
printf 'dist/\n' > "$R/.prettierignore"
commit_all ignore
run_last_commit
refute "what Prettier leaves out selects the static checks" 0 "$RC" "check-source static: SKIPPED"
refute "what Prettier leaves out selects the console" 0 "$RC" "check-console: SKIPPED"
printf '{ "semi": false }\n' > "$R/.prettierrc.json"
commit_all prettier
run_last_commit
refute "Prettier's settings select the console" 0 "$RC" "check-console: SKIPPED"
printf '{ "compilerOptions": {} }\n' > "$R/tsconfig.json"
commit_all compiler
run_last_commit
refute "the root's compiler settings select the console" 0 "$RC" "check-console: SKIPPED"
printf '{ "private": true }\n' > "$R/test/rig/package.json"
commit_all workspace
run_last_commit
refute "another workspace's manifest selects the console" 0 "$RC" "check-console: SKIPPED"

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
# tree's own configuration of its tools, one runs its gate on the tree's own
# parser, and a suite kept beside what it proves shares the harness.
stub_repo 0
mkdir -p "$R/.githooks" "$R/deploy/rig"
for suite in .chug/tasks/ci .chug/tasks/check-source .chug/tasks/check-boundaries \
	.chug/tasks/check-duplication .chug/tasks/check-comments .githooks/pre-commit deploy/rig/drill; do
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
printf '{}\n' > "$R/package-lock.json"
commit_all baseline
printf '{ "lockfileVersion": 3 }\n' > "$R/package-lock.json"
commit_all parser
run_last_commit 1
check "the toolchain selects the suite that runs its parser" 0 "$RC" "  - .chug/tasks/check-comments.test.sh"
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
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/two words.test.sh"
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/two words.sh"
commit_all spaced
printf '# changed\n' >> "$R/.chug/tasks/two words.sh"
commit_all spaced-script
run_last_commit 1
check "a script whose name holds a space selects its suite" 0 "$RC" "  - .chug/tasks/two words.test.sh"
printf '#!/bin/sh\nexit 0\n# changed\n' > "$R/deploy/rig/drill.sh"
commit_all script
run_last_commit 1
check "a script selects the suite kept beside it" 0 "$RC" "  - deploy/rig/drill.test.sh"
printf '\n# changed\n' >> "$R/.chug/tasks/ci.sh"
commit_all sequencer
run_last_commit 1
check "the sequencer selects its suite" 0 "$RC" "  - .chug/tasks/ci.test.sh"
refute "the sequencer selects every gate" 0 "$RC" "SKIPPED (no relevant changes)"
printf 'check:\n    true\n' > "$R/justfile"
commit_all recipe
run_last_commit 1
check "the justfile selects the sequencer's suite" 0 "$RC" "  - .chug/tasks/ci.test.sh"
printf 'export default [{}];\n' > "$R/eslint.config.js"
commit_all rules
run_last_commit 1
check "the lint rules select the suite that proves them" 0 "$RC" "  - .chug/tasks/check-source.test.sh"
# The sequencer selects every gate, and so does its selection library alone.
printf '\n# changed\n' >> "$R/.chug/tasks/_ci-select.sh"
commit_all selection
run_last_commit
refute "the selection library selects every gate" 0 "$RC" "SKIPPED (no relevant changes)"

# A PLACE A TOOL LOOKS IS AN INPUT WHILE IT HOLDS NOTHING. The console's
# formatter, bundler, style pipeline, browser list and package manager each
# look at the root for their settings, and the bundler above the contract for
# its compiler's, so one arriving there selects the console, left in the tree
# or committed; a file no tool looks for does not.
stub_repo 0
commit_all baseline
printf '# a page\n' > "$R/PAGE.md"
commit_all page
# The last commit and what is left in the tree, untracked files allowed.
run_left_in_tree() {
	OUT="$WORK/.out"
	set +e
	(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_ALLOW_UNTRACKED=1 CHUG_CI_SHELL_SUITES=0 \
		./.chug/tasks/ci.sh) >"$OUT" 2>&1
	RC=$?
	set -e
}
for setting in .editorconfig .prettierrc postcss.config.mjs .postcssrc.json .browserslistrc \
	browserslist .npmrc package.yaml lerna.json pnpm-workspace.yaml; do
	printf 'x\n' > "$R/$setting"
	run_left_in_tree
	refute "$setting left at the root selects the console" 0 "$RC" "check-console: SKIPPED"
	rm "$R/$setting"
done
mkdir -p "$R/src"
printf '{}\n' > "$R/src/tsconfig.json"
run_left_in_tree
refute "compiler settings left above the contract select the console" 0 "$RC" "check-console: SKIPPED"
rm "$R/src/tsconfig.json"
printf 'x\n' > "$R/notes.txt"
run_left_in_tree
check "a file at the root no tool looks for leaves the console out" 0 "$RC" "check-console: SKIPPED"
rm "$R/notes.txt"
printf '[*]\nindent_style = tab\n' > "$R/.editorconfig"
commit_all editorconfig
run_last_commit
refute "a setting committed at the root selects the console" 0 "$RC" "check-console: SKIPPED"
check "a setting the console's tools read is no input of the model's gate" 0 "$RC" "check-model: SKIPPED"

# THE MODEL'S GATE FOLLOWS QUINT: a lock that moves no package in quint's
# closure leaves it out, and one that moves quint or a package quint depends on
# brings it in, read past any colour or diff program git is configured with. A
# lock that cannot be read at either end, or compared at all, brings it in
# too. The manifest is not one of its inputs.
stub_repo 0
lock_json 0.32.0 1.0.0 4.0.0 1.0.0 > "$R/package-lock.json"
printf '{ "devDependencies": { "left-pad": "1.0.0" } }\n' > "$R/package.json"
commit_all baseline
lock_json 0.32.0 1.0.0 4.0.0 1.0.1 > "$R/package-lock.json"
printf '{ "devDependencies": { "left-pad": "1.0.1" } }\n' > "$R/package.json"
commit_all other-package
run_last_commit
check "a lock change that leaves quint's closure alone skips Quint" 0 "$RC" "check-model: SKIPPED"
check "a package change still reaches the model's generated API" 0 "$RC" "stub check-model-api"
OUT="$WORK/.out"
set +e
(cd "$R" && TMPDIR="$WORK/absent-tmp" CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
refute "a lock compared where no scratch file can be made selects Quint" 0 "$RC" "check-model: SKIPPED"
# What npm records of a copy beside what it is: the flags it derives from who
# asked, and where it put the copy, which a lock moves with nothing installed
# changing for quint.
lock_json 0.32.0 1.0.0 4.0.0 1.0.1 flags > "$R/package-lock.json"
commit_all flags
run_last_commit
check "a lock that flips the flags npm derives skips Quint" 0 "$RC" "check-model: SKIPPED"
refute "a lock that flips the flags npm derives still selects the console" 0 "$RC" "check-console: SKIPPED"
lock_json 0.32.0 1.0.0 4.0.0 1.0.1 hoisted > "$R/package-lock.json"
commit_all hoisted
run_last_commit
check "a lock that moves where quint's copy of a package sits skips Quint" 0 "$RC" "check-model: SKIPPED"
refute "a lock that moves where a copy sits still selects the console" 0 "$RC" "check-console: SKIPPED"
lock_json 0.32.0 1.1.0 4.0.0 1.0.1 > "$R/package-lock.json"
run_last_commit
refute "a lock moving what quint depends on, not yet committed, selects Quint" 0 "$RC" "check-model: SKIPPED"
commit_all quint-dependency
run_last_commit
refute "a lock moving a package quint depends on selects Quint" 0 "$RC" "check-model: SKIPPED"
lock_json 0.33.0 1.1.0 4.0.0 1.0.1 > "$R/package-lock.json"
commit_all quint
run_last_commit
refute "a lock that moves quint selects Quint" 0 "$RC" "check-model: SKIPPED"
git -C "$R" config color.ui always
git -C "$R" config diff.external "echo rendered"
run_last_commit
refute "a quint bump is read past a git that colours and renders its own way" 0 "$RC" "check-model: SKIPPED"
lock_json 0.33.0 1.1.0 4.0.0 1.0.2 > "$R/package-lock.json"
commit_all other-package-again
run_last_commit
check "a lock that leaves quint alone is read the same way there" 0 "$RC" "check-model: SKIPPED"
git -C "$R" config --unset diff.external
git -C "$R" config --unset color.ui
printf 'not a lock\n' > "$R/package-lock.json"
commit_all unreadable
run_last_commit
refute "a lock that cannot be read selects Quint" 0 "$RC" "check-model: SKIPPED"
stub_repo 0
commit_all baseline
lock_json 0.32.0 1.0.0 4.0.0 1.0.0 > "$R/package-lock.json"
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_ALLOW_UNTRACKED=1 CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
refute "a lock the base does not hold selects Quint" 0 "$RC" "check-model: SKIPPED"

# A RUN THAT RAN NOTHING SAYS SO.
stub_repo 0
commit_all baseline
run_gates_only
check "a change that selects nothing says nothing ran" 0 "$RC" "no gate selected; nothing ran"
refute "a run of nothing is not called clean" 0 "$RC" "all gates clean"

# AN UNTRACKED FILE IS ONE MOST GATES NEVER READ, so a run that leaves one does
# not end clean though every gate passed, and names it before any gate runs.
untracked_last_line() { # the run's last line, as $OUT for the next check
	tail -n 1 "$OUT" > "$WORK/.last"
	OUT="$WORK/.last"
}
untracked_listing() { # what the run printed before its first gate, as $OUT
	sed -n '/^---/q;p' "$OUT" > "$WORK/.listing"
	OUT="$WORK/.listing"
}
stub_repo 0
commit_all baseline
mkdir -p "$R/src"
printf 'export const unread = 1;\n' > "$R/src/unread.ts"
run_gates_only
refute "a run with an untracked file is not called clean" 1 "$RC" "all gates clean"
untracked_last_line
check "an untracked file fails a run every gate passed, on its last line" 1 "$RC" "ci: 1 untracked file(s) went unchecked; git add them or ignore them"
run_gates_only
untracked_listing
check "the untracked file is named before any gate runs" 1 "$RC" "ci:   src/unread.ts"
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_FULL=1 CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "an untracked file fails a full run too" 1 "$RC" "1 untracked file(s) went unchecked"
printf '#!/bin/sh\necho stub doc-lint\nexit 2\n' > "$R/.chug/tasks/doc-lint.sh"
git -C "$R" add .chug/tasks/doc-lint.sh
run_gates_only
check "an untracked file leaves a could-not-run exiting 2" 2 "$RC" "1 untracked file(s) went unchecked"

# A listing git could not make is a could-not-run, not a tree with nothing
# untracked. An index git cannot read still leaves the checkout found.
stub_repo 0
commit_all baseline
echo garbage > "$R/.git/index"
run_gates_only
check "untracked files git cannot list are a could-not-run" 2 "$RC" "ci: LINTER ERROR — could not list the files git does not track"
untracked_last_line
check "the last line says the listing failed, not a gate" 2 "$RC" "ci: the files git does not track could not be listed; this is not a pass"

# The listing is bounded, and the count is of every file, not of those shown.
shown_max="$(sed -n 's/^untracked_shown_max=//p' "$SUT")"
stub_repo 0
commit_all baseline
mkdir -p "$R/many"
n=0
while [ "$n" -le "$shown_max" ]; do
	printf '%s\n' "$n" > "$R/many/$n.txt"
	n=$((n + 1))
done
run_gates_only
check "the count is of every untracked file" 1 "$RC" "ci: $((shown_max + 1)) untracked file(s) went unchecked"
untracked_listing
check "the listing past its bound counts the rest" 1 "$RC" "ci:   and 1 more"
listed="$(grep -c '^ci:   many/' "$OUT" || true)"
OUT="$WORK/.out"
printf 'listed %s\n' "$listed" >> "$OUT"
check "the listing stops at its bound" 1 "$RC" "listed $shown_max"

# A file an ignore file names is not untracked to git, the repository's own
# exclude among them, which is where a job's harness puts what it made.
stub_repo 0
printf 'build/\n' > "$R/.gitignore"
commit_all baseline
mkdir -p "$R/build"
printf 'built\n' > "$R/build/out.txt"
printf '/harness.txt\n' >> "$(git -C "$R" rev-parse --absolute-git-dir)/info/exclude"
printf 'made by the harness\n' > "$R/harness.txt"
printf '# a page\n' > "$R/PAGE.md"
git -C "$R" add PAGE.md
run_gates_only
check "ignored files leave a clean run clean" 0 "$RC" "all gates clean"
refute "ignored files are not listed" 0 "$RC" "untracked"

# The override lets a run with an untracked file end as its gates did.
stub_repo 0
commit_all baseline
printf 'export const unread = 1;\n' > "$R/unread.ts"
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_ALLOW_UNTRACKED=1 CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "the override lets a run with an untracked file end clean" 0 "$RC" "all gates clean"
check "the override still names the untracked file" 0 "$RC" "ci:   unread.ts"

# Nothing untracked leaves a run as it was.
stub_repo 0
commit_all baseline
printf '# a page\n' > "$R/PAGE.md"
git -C "$R" add PAGE.md
run_gates_only
check "a run with nothing untracked ends clean" 0 "$RC" "all gates clean"
refute "a run with nothing untracked lists nothing" 0 "$RC" "untracked"

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

# A PASS ON RECORD IS REUSED RATHER THAN RUN AGAIN. The stub stands in for
# track-record: it answers the probe with STUB_TR_VERSION_RC, logs each call's
# arguments and the store's variables it was handed, and runs the command after
# `--` — or, for a name STUB_TR_REUSE lists, prints a replayed log and the
# REUSED line and exits STUB_TR_REUSE_RC, running nothing. Under STUB_TR_DIGEST
# it also logs a digest of what its tools print, as track-record keys on it,
# and each tool that fails, which would leave the gate unrecorded; for the name
# STUB_TR_KILL gives, it kills the shell that ran it.
#
# Under STUB_TR_STORE, a directory, it keeps a store as track-record does: it
# keys each call on its name, its command, each tool's command and output, each
# variable, the platform, the salt and the tracked files its inputs match, or
# the whole tree given none, as they are on disk, and logs the key; it neither
# looks up nor records where a tool fails or an untracked file sits within the
# inputs; it replays a pass on record, unless TRACK_RECORD_FRESH=1, and records
# an exit of 0. Unlike track-record it takes an input that matches nothing.
TRBIN="$WORK/trbin"
TRLOG="$WORK/tr.log"
mkdir -p "$TRBIN"
cat > "$TRBIN/track-record" <<'STUB'
#!/bin/sh
if [ "$1" = "--version" ]; then exit "${STUB_TR_VERSION_RC:-0}"; fi
{
	printf '%s|' "$@"
	printf '\n'
	printf 'env|FRESH=%s|URL=%s|NAMESPACE=%s|\n' "${TRACK_RECORD_FRESH-unset}" \
		"${TRACK_RECORD_URL-unset}" "${TRACK_RECORD_NAMESPACE-unset}"
} >>"$STUB_TR_LOG"
name=""
tools=""
specs=""
keyed=1
material="$STUB_TR_LOG.material"
: >"$material"
while [ "$#" -gt 0 ]; do
	case "$1" in
	--) shift; break ;;
	--name) name="$2"; printf 'name %s\n' "$2" >>"$material"; shift 2 ;;
	--inputs) specs="$specs$2
"; shift 2 ;;
	--tool)
		if [ -n "${STUB_TR_DIGEST:-}${STUB_TR_STORE:-}" ]; then
			if ! sh -c "$2" >"$STUB_TR_LOG.out" 2>"$STUB_TR_LOG.err"; then
				printf 'toolfail|%s|%s\n' "$name" "$2" >>"$STUB_TR_LOG"
				keyed=0
			fi
			tools="$tools$(cksum <"$STUB_TR_LOG.out") $(cksum <"$STUB_TR_LOG.err")/"
			printf 'tool %s\n' "$2" >>"$material"
			cat "$STUB_TR_LOG.out" "$STUB_TR_LOG.err" >>"$material"
		fi
		shift 2
		;;
	--env) printf 'env %s %s\n' "$2" "$(printenv "$2" || echo '(unset)')" >>"$material"; shift 2 ;;
	--salt) printf 'salt %s\n' "$2" >>"$material"; shift 2 ;;
	--platform) printf 'platform %s\n' "$(uname -sm)" >>"$material"; shift ;;
	*) shift ;;
	esac
done
if [ -n "${STUB_TR_DIGEST:-}" ]; then printf 'digest|%s|%s\n' "$name" "$tools" >>"$STUB_TR_LOG"; fi
if [ "$name" = "${STUB_TR_KILL:-}" ]; then kill -KILL "$PPID"; exit 0; fi
for listed in ${STUB_TR_REUSE:-}; do
	if [ "$listed" = "$name" ]; then
		echo "stub log replayed for $name"
		echo "track-record: REUSED $name (recorded 2026-01-01T00:00:00Z by stub)" >&2
		exit "${STUB_TR_REUSE_RC:-0}"
	fi
done
[ -n "${STUB_TR_STORE:-}" ] || exec "$@"
printf 'argv' >>"$material"
printf ' %s' "$@" >>"$material"
printf '\n' >>"$material"
(
	set -f
	IFS='
'
	# shellcheck disable=SC2086 # a pathspec a line, by construction
	git ls-files -- $specs | while IFS= read -r file; do
		if [ -f "$file" ]; then
			if [ -x "$file" ]; then kind=exec; else kind=file; fi
			printf 'file %s %s %s\n' "$file" "$kind" "$(git hash-object --no-filters -- "$file")"
		else
			printf 'file %s deleted\n' "$file"
		fi
	done
	# shellcheck disable=SC2086 # a pathspec a line, by construction
	git ls-files --others --exclude-standard -- $specs | sed 's/^/untracked /'
) >>"$material"
if grep -q '^untracked ' "$material"; then keyed=0; fi
key="$(cksum <"$material" | cut -d' ' -f1)"
printf 'key|%s|%s|%s\n' "$name" "$key" "$keyed" >>"$STUB_TR_LOG"
if [ "$keyed" = 1 ] && [ "${TRACK_RECORD_FRESH:-0}" != 1 ] && [ -e "$STUB_TR_STORE/$key" ]; then
	echo "stub log replayed for $name"
	echo "track-record: REUSED $name (recorded 2026-01-01T00:00:00Z by stub)" >&2
	exit 0
fi
"$@"
rc=$?
if [ "$rc" -eq 0 ] && [ "$keyed" = 1 ]; then : >"$STUB_TR_STORE/$key"; fi
exit "$rc"
STUB
chmod +x "$TRBIN/track-record"
salt="$(sed -n 's/^record_salt="\(.*\)"$/\1/p' "$SUT")"
record_tool_node="" record_tool_install="" record_tool_ignored="" record_tool_installed=""
record_tool_probed=""
eval "$(sed -n '/^record_tool_[a-z]*="[^"]*"$/p' "$SUT")"
[ -n "$record_tool_node" ] && [ -n "$record_tool_install" ] && [ -n "$record_tool_ignored" ] &&
	[ -n "$record_tool_installed" ] && [ -n "$record_tool_probed" ]
# Every gate the sequencer names is wrapped but check-roster and doc-lint.
gate_calls="$(named_gates "$SUT" | grep -vcx -e check-roster -e doc-lint)"

# The gate stage with the stub first on PATH and whatever VAR=value the case
# names; the token is the case's to give.
run_recorded() { # [VAR=value...]
	OUT="$WORK/.out"
	: > "$TRLOG"
	set +e
	(cd "$R" && env PATH="$TRBIN:$PATH" STUB_TR_LOG="$TRLOG" CHUG_CI_SHELL_SUITES=0 "$@" \
		./.chug/tasks/ci.sh) >"$OUT" 2>&1
	RC=$?
	set -e
}
# The log as $OUT, with the calls counted into it.
recorded_log() {
	cp "$TRLOG" "$WORK/.log"
	printf 'calls %s\n' "$(grep -c '^run|' "$TRLOG" || true)" >> "$WORK/.log"
	OUT="$WORK/.log"
}

# Without a token, with a token file that is missing or holds none, with a
# track-record that does not run, and with TRACK_RECORD_OFF=1, the run is the
# one it is with no track-record at all.
stub_repo 0
run_gates_only
cp "$OUT" "$WORK/.plain"
printf ' \n' > "$WORK/blank-token"
for case in "no token|" "a token file that is not there|TRACK_RECORD_TOKEN_FILE=$WORK/absent-token" \
	"a token file that holds none|TRACK_RECORD_TOKEN_FILE=$WORK/blank-token" \
	"a track-record that does not run|TRACK_RECORD_TOKEN=t STUB_TR_VERSION_RC=1" \
	"TRACK_RECORD_OFF=1|TRACK_RECORD_TOKEN=t TRACK_RECORD_OFF=1"; do
	# shellcheck disable=SC2086 # the case's assignments are words by construction
	run_recorded ${case#*|}
	if cmp -s "$OUT" "$WORK/.plain"; then echo "same output" >> "$OUT"; fi
	check "${case%%|*} leaves the run as it is with no track-record" 0 "$RC" "same output"
	recorded_log
	check "${case%%|*} wraps nothing" 0 "$RC" "calls 0"
done

# A token, in the variable or in a file, wraps every gate the sequencer calls
# once but check-roster and doc-lint, named by its id, keyed on node and the
# salt and on what else its verdict reads, and never on the platform.
# check-roster and doc-lint run as they do unwrapped.
printf 'trk_stub\n' > "$WORK/token"
run_recorded TRACK_RECORD_TOKEN_FILE="$WORK/token"
check "a token file wraps the run" 0 "$RC" "a pass on record at https://track-record.vteng.io (chuggy) is reused"
check "a wrapped clean run counts what it reused" 0 "$RC" "ci: all gates clean (0 reused)"
check "check-roster still runs" 0 "$RC" "stub check-roster"
check "doc-lint still runs" 0 "$RC" "stub doc-lint"
recorded_log
check "every gate the sequencer calls is wrapped once" 0 "$RC" "calls $gate_calls"
refute "no gate is keyed on the platform" 0 "$RC" "|--platform|"
refute "check-roster is not wrapped" 0 "$RC" "run|--name|check-roster|"
refute "doc-lint is not wrapped" 0 "$RC" "run|--name|doc-lint|"
check "the store defaults to the shared one" 0 "$RC" "env|FRESH=unset|URL=https://track-record.vteng.io|NAMESPACE=chuggy|"
# A gate keyed on the whole tree holds the whole install record and every
# ignored file, and passes no inputs.
common="--tool|$record_tool_node|--tool|$record_tool_install|--tool|$record_tool_ignored|--salt|$salt|"
keyed=0
for gate in \
	"check-paths|${common}--tool|git log --diff-filter=D --name-only --format=|--|./.chug/tasks/check-paths.sh|" \
	"source-static|--|./.chug/tasks/check-source.sh|--static|" \
	"source-unit|${common}--env|CHUG_SETUP_PROGRAM|--|./.chug/tasks/check-source.sh|--unit|"; do
	id="${gate%%|*}"
	shape="${gate#*|}"
	case "$shape" in --\|*) shape="$common$shape" ;; esac
	check "$id is keyed on the whole tree and what else its verdict reads" 0 "$RC" "run|--name|$id|$shape"
	case "$shape" in "$common--|"*) ;; *) keyed=$((keyed + 1)) ;; esac
done
# The model's gate holds its model, its script and quint's installed closure,
# and the ignored files among them, and nothing else of the tree.
check "check-model is keyed on the model, its script and quint alone" 0 "$RC" \
	"run|--name|check-model|--tool|$record_tool_node|--tool|$record_tool_installed '@informalsystems/quint'|--tool|$record_tool_ignored ':(glob)model/**/*.qnt' '.chug/tasks/check-model.sh'|--inputs|:(glob)model/**/*.qnt|--inputs|.chug/tasks/check-model.sh|--salt|$salt|--|./.chug/tasks/check-model.sh|"
# Every other narrowed gate passes its inputs and scopes its ignored files to
# them; a gate that runs the root's toolchain broadly holds the whole install
# record, and one that runs named packages holds their closure.
narrowed=0
for gate in \
	"check-model|packages|--|./.chug/tasks/check-model.sh|" \
	"check-model-api|packages|--|./.chug/tasks/check-model-api.sh|" \
	"check-conformance|packages|--env|CHUG_GOLDEN_DIR|--|./.chug/tasks/check-conformance.sh|" \
	"check-random|packages|--env|CHUG_WALK_SAMPLES|--env|CHUG_WALK_SEED_BASE|--env|CHUG_WALK_SEED|--env|CHUG_WALK_INSTANCE|--|./.chug/tasks/check-random.sh|" \
	"check-console|install|--|./.chug/tasks/check-console.sh|" \
	"check-postgres|install|--env|CHUG_PG_URL|--env|CHUG_PG_IMAGE|--|./.chug/tasks/check-postgres.sh|" \
	"check-queries|install|--env|CHUG_PG_URL|--env|CHUG_PG_IMAGE|--|./.chug/tasks/check-queries.sh|" \
	"check-keto|install|--env|CHUG_KETO_READ_URL|--env|CHUG_KETO_WRITE_URL|--env|CHUG_KETO_IMAGE|--env|CHUG_PG_URL|--env|CHUG_PG_IMAGE|--|./.chug/tasks/check-keto.sh|"; do
	id="${gate%%|*}"
	rest="${gate#*|}"
	held="${rest%%|*}"
	tail="${rest#*|}"
	grep "^run|--name|$id|" "$TRLOG" > "$WORK/.line" || true
	OUT="$WORK/.line"
	check "$id is keyed on its inputs and what else its verdict reads" 0 "$RC" "|--salt|$salt|$tail"
	check "$id passes its inputs" 0 "$RC" "|--inputs|"
	check "$id holds the ignored files within its inputs" 0 "$RC" "|--tool|$record_tool_ignored '"
	refute "$id holds no ignored file outside them" 0 "$RC" "|--tool|$record_tool_ignored|"
	case "$held" in
	install) check "$id holds the whole install record" 0 "$RC" "|--tool|$record_tool_install|" ;;
	*) refute "$id holds no more of the install than it runs" 0 "$RC" "|--tool|$record_tool_install|" ;;
	esac
	case "$held" in
	packages) check "$id holds the closure of the packages it runs" 0 "$RC" "|--tool|$record_tool_installed '" ;;
	*) refute "$id holds no package closure" 0 "$RC" "|--tool|$record_tool_installed '@" ;;
	esac
	OUT="$WORK/.log"
	narrowed=$((narrowed + 1))
done
# A narrowed gate whose tools look above its inputs holds each place they look:
# the console the root's settings and the package directory and compiler
# settings above the contract, the replays that package directory, the
# generated API the one above its generator, the query check the linter's
# settings, and the server gates the package directories and manifests above
# their database helper. The model's gate looks nowhere else, and a whole-tree
# key holds every place already.
for gate in \
	"check-console|'.editorconfig'|'.prettierrc'|':(glob)postcss.config.*'|'src/tsconfig.json'|'src/node_modules'" \
	"check-conformance|'src/node_modules'" "check-random|'src/node_modules'" \
	"check-model-api|'scripts/node_modules'" \
	"check-queries|':(glob)eslint.config.*'|'eslint-suppressions.json'" \
	"check-postgres|'.chug/tasks/node_modules'|'.chug/tasks/package.json'" \
	"check-keto|'.chug/node_modules'|'.chug/package.json'"; do
	id="${gate%%|*}"
	grep "^run|--name|$id|" "$TRLOG" > "$WORK/.line" || true
	OUT="$WORK/.line"
	places="${gate#*|}|"
	while [ -n "$places" ]; do
		check "$id holds ${places%%|*}, where its tools look" 0 "$RC" " ${places%%|*}"
		places="${places#*|}"
	done
	check "$id holds the places its tools look" 0 "$RC" "|--tool|$record_tool_probed '"
done
OUT="$WORK/.log"
printf 'looking %s\n' "$(grep -c "|--tool|$record_tool_probed" "$TRLOG" || true)" >> "$OUT"
check "no other gate holds a place a tool looks" 0 "$RC" "looking 7"
# Every gate neither table names is keyed on the whole tree and nothing more.
printf 'plain %s\n' "$(grep -cF "|$common--|./" "$TRLOG" || true)" >> "$OUT"
check "a whole-tree gate whose verdict reads nothing else is keyed on nothing else" 0 "$RC" \
	"plain $((gate_calls - narrowed - keyed))"
printf 'with inputs %s\n' "$(grep -c '|--inputs|' "$TRLOG" || true)" >> "$OUT"
check "no gate keyed on the whole tree passes inputs" 0 "$RC" "with inputs $narrowed"
# Each narrowed gate holds exactly what it declares: the packages it runs or
# the whole install, its pathspecs, text before code, as the scope of its
# ignored files and as its inputs, and after `--` the places its tools look.
pin_scope() { # <gate or suite> <what it holds of the install, or ""> <pathspec>... [-- <place>...]
	pin_id="$1"
	pin_held="${2:+--tool|$2|}"
	shift 2
	pin_specs=""
	pin_inputs=""
	pin_places=""
	while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
		pin_specs="$pin_specs '$1'"
		pin_inputs="$pin_inputs--inputs|$1|"
		shift
	done
	[ "$#" -eq 0 ] || shift
	for pin_place do pin_places="$pin_places '$pin_place'"; done
	[ -z "$pin_places" ] || pin_places="--tool|$record_tool_probed$pin_places|"
	grep "^run|--name|$pin_id|" "$TRLOG" > "$WORK/.line" || true
	OUT="$WORK/.line"
	check "$pin_id holds exactly the scope it declares" 0 "$RC" \
		"run|--name|$pin_id|--tool|$record_tool_node|$pin_held--tool|$record_tool_ignored$pin_specs|$pin_places$pin_inputs--salt|$salt|"
	OUT="$WORK/.log"
}
pin_scope check-model-api "$record_tool_installed '@informalsystems/quint' 'prettier'" \
	':(glob)model/**/*.qnt' scripts/generate-model-api.ts src/generated src/domain/generated \
	.chug/tasks/check-model-api.sh ':(glob)**/package.json' -- scripts/node_modules scripts/package.json
pin_scope check-conformance "$record_tool_installed 'zod'" src/domain src/generated test/conformance \
	test/domain test/itf test/golden model .chug/tasks/check-conformance.sh ':(glob)**/package.json' \
	-- src/node_modules src/package.json
pin_scope check-random "$record_tool_installed 'zod'" src/domain src/generated test/random \
	test/conformance test/domain test/itf model .chug/tasks/check-random.sh ':(glob)**/package.json' \
	-- src/node_modules src/package.json
pin_scope check-console "$record_tool_install" ui src/contract test/fixtures/configurations \
	.chug/configurations scripts/console-policy.ts scripts/check-console-policy.ts package-lock.json \
	tsconfig.json .gitignore .prettierrc.json .prettierignore .chug/tasks/check-console.sh \
	':(glob)**/package.json' -- .browserslistrc browserslist .editorconfig .npmrc .prettierrc \
	package.yaml lerna.json pnpm-workspace.yaml ':(glob).postcssrc*' ':(glob)postcss.config.*' \
	src/node_modules src/package.json src/tsconfig.json
pin_scope check-postgres "$record_tool_install" src test deploy/rig/wipe-tickets.sql package.json \
	.chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts .chug/tasks/check-postgres.sh \
	.chug/tasks/_test-timeout.sh -- .chug/tasks/node_modules .chug/tasks/package.json .chug/node_modules .chug/package.json
pin_scope check-queries "$record_tool_install" src test scripts ui package.json tsconfig.json \
	eslint.config.js .chug/tasks/_postgres.sh .chug/tasks/check-queries.sh \
	-- ':(glob)eslint.config.*' .eslintignore .eslintcache eslint-suppressions.json
pin_scope check-keto "$record_tool_install" src test .chug/tasks/keto package.json \
	.chug/tasks/_keto.sh .chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts \
	.chug/tasks/check-keto.sh .chug/tasks/_test-timeout.sh \
	-- .chug/tasks/node_modules .chug/tasks/package.json .chug/node_modules .chug/package.json

run_recorded TRACK_RECORD_TOKEN=t TRACK_RECORD_URL=http://store.test TRACK_RECORD_NAMESPACE=elsewhere
recorded_log
check "the store and namespace can be named" 0 "$RC" "env|FRESH=unset|URL=http://store.test|NAMESPACE=elsewhere|"

# A full run asks every gate fresh, and still records; the variable alone
# does the same without forcing every gate.
run_recorded TRACK_RECORD_TOKEN=t CHUG_CI_FULL=1
check "a full run says it reuses nothing" 0 "$RC" "and none on record is reused"
recorded_log
check "a full run wraps every gate" 0 "$RC" "calls $gate_calls"
refute "a full run asks no gate for a pass on record" 0 "$RC" "FRESH=unset"
run_recorded TRACK_RECORD_TOKEN=t TRACK_RECORD_FRESH=1
recorded_log
refute "TRACK_RECORD_FRESH=1 reaches every gate" 0 "$RC" "FRESH=unset"

# A gate the selection library does not name is keyed on the whole tree.
stub_repo 0
awk '{ print } /^run_selected_gate check-vendored / {
	print "run_selected_gate undeclared \"undeclared\" ./.chug/tasks/undeclared.sh" }' \
	"$R/.chug/tasks/ci.sh" > "$WORK/.undeclared"
cat "$WORK/.undeclared" > "$R/.chug/tasks/ci.sh"
printf '#!/bin/sh\necho stub undeclared\nexit 0\n' > "$R/.chug/tasks/undeclared.sh"
chmod +x "$R/.chug/tasks/undeclared.sh"
git -C "$R" add -A
run_recorded TRACK_RECORD_TOKEN=t
recorded_log
check "a gate the selection library does not name is keyed on the whole tree" 0 "$RC" \
	"run|--name|undeclared|$common--|./.chug/tasks/undeclared.sh|"

# A reused pass is counted as a pass and as reused, from track-record's own
# line for that gate or suite — check-model prints the line of check-model-api,
# whose name begins with its own, and that counts for neither; a gate's
# replayed log is printed, and a suite's REUSED line is.
stub_repo 0
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/passing.test.sh"
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/ran.test.sh"
printf '#!/bin/sh\necho "track-record: REUSED check-model-api (recorded 2026-01-01T00:00:00Z by stub)" >&2\nexit 0\n' \
	> "$R/.chug/tasks/check-model.sh"
git -C "$R" add -A
run_recorded TRACK_RECORD_TOKEN=t CHUG_CI_SHELL_SUITES=1 \
	"STUB_TR_REUSE=check-figures source-unit .chug/tasks/passing.test.sh"
check "a reused pass is counted, a gate's and a suite's alike" 0 "$RC" "ci: all gates clean (3 reused)"
check "a reused gate's log is printed" 0 "$RC" "stub log replayed for check-figures"
refute "a reused gate does not run" 0 "$RC" "stub check-figures"
check "a reused suite says so" 0 "$RC" "    track-record: REUSED .chug/tasks/passing.test.sh (recorded"
recorded_log
check "a suite is wrapped on its inputs, keyed on the platform too" 0 "$RC" \
	"run|--name|.chug/tasks/passing.test.sh|--tool|$record_tool_node|--tool|$record_tool_ignored '.chug/tasks/passing.test.sh' '.chug/tasks/passing.sh' '.chug/tasks/_suite.sh'|--inputs|.chug/tasks/passing.test.sh|--inputs|.chug/tasks/passing.sh|--inputs|.chug/tasks/_suite.sh|--salt|$salt|--platform|--|sh|.chug/tasks/passing.test.sh|"
# A suite takes the salt the sequencer names, so a new one disowns its pass as
# it does a gate's, and a suite whose name holds a space is one input.
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/two words.test.sh"
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/two words.sh"
sed 's/^record_salt=.*/record_salt="another-salt"/' "$R/.chug/tasks/ci.sh" > "$WORK/.salted"
cat "$WORK/.salted" > "$R/.chug/tasks/ci.sh"
git -C "$R" add -A
run_recorded TRACK_RECORD_TOKEN=t CHUG_CI_SHELL_SUITES=1
recorded_log
check "a suite is keyed on the salt the sequencer names" 0 "$RC" \
	"|--salt|another-salt|--platform|--|sh|.chug/tasks/passing.test.sh|"
check "a suite whose name holds a space is one input" 0 "$RC" \
	"|--inputs|.chug/tasks/two words.test.sh|--inputs|.chug/tasks/two words.sh|--inputs|.chug/tasks/_suite.sh|"

# Each suite holds exactly what it declares: itself, the script it proves, the
# shared harness and what that script reads, or the whole tree for one that
# proves a gate keyed on it.
stub_repo 0
commit_all baseline
for suite in .chug/tasks/ci.test.sh .chug/tasks/check-source.test.sh \
	.chug/tasks/check-boundaries.test.sh .chug/tasks/check-duplication.test.sh \
	.chug/tasks/check-comments.test.sh .chug/tasks/check-conformance.test.sh \
	.chug/tasks/check-model-api.test.sh .chug/tasks/check-shell-quoting.test.sh \
	.chug/tasks/check-random.test.sh .chug/tasks/emit-goldens.test.sh .chug/tasks/check-keto.test.sh \
	.chug/tasks/check-postgres.test.sh .chug/tasks/check-queries.test.sh .chug/tasks/other.test.sh \
	.githooks/pre-commit.test.sh images/worker/core.test.sh deploy/rig/drill.test.sh; do
	mkdir -p "$R/${suite%/*}"
	printf '#!/bin/sh\nexit 0\n' > "$R/$suite"
done
git -C "$R" add -A
run_recorded TRACK_RECORD_TOKEN=t CHUG_CI_SHELL_SUITES=1
recorded_log
pin_scope .chug/tasks/ci.test.sh "" .chug/tasks/ci.test.sh .chug/tasks/ci.sh .chug/tasks/_ci-select.sh \
	.chug/tasks/_ignored-inputs.sh .chug/tasks/_installed-inputs.sh .chug/tasks/_probed-inputs.sh \
	.chug/tasks/_suite.sh justfile package.json
pin_scope .chug/tasks/check-source.test.sh "$record_tool_install" .chug/tasks/check-source.test.sh \
	.chug/tasks/check-source.sh .chug/tasks/_test-timeout.sh .chug/tasks/_suite.sh tsconfig.json tsconfig.contract.json \
	eslint.config.js .prettierrc.json .prettierignore package.json
pin_scope .chug/tasks/check-boundaries.test.sh "$record_tool_install" \
	.chug/tasks/check-boundaries.test.sh .chug/tasks/check-boundaries.sh .chug/tasks/_suite.sh \
	tsconfig.json .dependency-cruiser.cjs package.json
pin_scope .chug/tasks/check-duplication.test.sh "$record_tool_install" \
	.chug/tasks/check-duplication.test.sh .chug/tasks/check-duplication.sh .chug/tasks/_suite.sh \
	.jscpd.json package.json
pin_scope .chug/tasks/check-comments.test.sh "$record_tool_install" .chug/tasks/check-comments.test.sh \
	.chug/tasks/check-comments.sh .chug/tasks/_suite.sh package.json
pin_scope .chug/tasks/check-conformance.test.sh "$record_tool_installed 'zod'" \
	.chug/tasks/check-conformance.test.sh .chug/tasks/_suite.sh src/domain src/generated \
	test/conformance test/domain test/itf test/golden model .chug/tasks/check-conformance.sh \
	':(glob)**/package.json' -- src/node_modules src/package.json
pin_scope .chug/tasks/check-model-api.test.sh "$record_tool_installed '@informalsystems/quint' 'prettier'" \
	.chug/tasks/check-model-api.test.sh .chug/tasks/_suite.sh ':(glob)model/**/*.qnt' \
	scripts/generate-model-api.ts src/generated src/domain/generated .chug/tasks/check-model-api.sh \
	':(glob)**/package.json' -- scripts/node_modules scripts/package.json
pin_scope .chug/tasks/check-shell-quoting.test.sh "$record_tool_install"
pin_scope .chug/tasks/check-random.test.sh "$record_tool_installed 'zod'" \
	.chug/tasks/check-random.test.sh .chug/tasks/_suite.sh src test .chug/tasks/check-conformance.sh \
	src/domain src/generated test/random test/conformance test/domain test/itf model \
	.chug/tasks/check-random.sh ':(glob)**/package.json' -- src/node_modules src/package.json
pin_scope .chug/tasks/emit-goldens.test.sh "$record_tool_installed 'prettier' '@informalsystems/quint'" \
	.chug/tasks/emit-goldens.test.sh .chug/tasks/emit-goldens.sh .chug/tasks/_suite.sh .gitignore \
	.prettierignore ':(glob)model/**/*.qnt' .chug/tasks/check-model.sh
pin_scope .chug/tasks/check-keto.test.sh "" .chug/tasks/check-keto.test.sh .chug/tasks/check-keto.sh \
	.chug/tasks/_keto.sh .chug/tasks/_postgres.sh .chug/tasks/_gate-fixture.sh .chug/tasks/_suite.sh \
	.chug/tasks/keto .chug/tasks/_test-timeout.sh
pin_scope .chug/tasks/check-postgres.test.sh "" .chug/tasks/check-postgres.test.sh \
	.chug/tasks/check-postgres.sh .chug/tasks/_postgres.sh .chug/tasks/_gate-fixture.sh \
	.chug/tasks/_suite.sh .chug/tasks/_test-timeout.sh
pin_scope .chug/tasks/check-queries.test.sh "" .chug/tasks/check-queries.test.sh \
	.chug/tasks/check-queries.sh .chug/tasks/_postgres.sh .chug/tasks/_gate-fixture.sh \
	.chug/tasks/_suite.sh
pin_scope .chug/tasks/other.test.sh "" .chug/tasks/other.test.sh .chug/tasks/other.sh .chug/tasks/_suite.sh
pin_scope .githooks/pre-commit.test.sh "" .githooks/pre-commit.test.sh .githooks/pre-commit \
	.chug/tasks/_suite.sh
pin_scope images/worker/core.test.sh "" images/worker/core.test.sh images/worker/core.sh \
	.chug/tasks/_suite.sh package.json
pin_scope deploy/rig/drill.test.sh "" deploy/rig/drill.test.sh deploy/rig/drill.sh .chug/tasks/_suite.sh

# A REUSED line turns no failure into a pass and counts nothing then.
stub_failing() { # <gate> <exit> — every named gate stubbed clean but that one
	stub_repo 0
	printf '#!/bin/sh\necho stub %s\nexit %s\n' "$1" "$2" > "$R/.chug/tasks/$1.sh"
	git -C "$R" add -A
}
stub_failing check-figures 1
run_recorded TRACK_RECORD_TOKEN=t
check "a wrapped finding exits 1" 1 "$RC" "ci: FAILED — check-figures"
stub_failing check-figures 2
run_recorded TRACK_RECORD_TOKEN=t
check "a wrapped could-not-run exits 2" 2 "$RC" "ci: LINTER ERROR (2) — check-figures could not run"
stub_repo 0
run_recorded TRACK_RECORD_TOKEN=t STUB_TR_REUSE=check-figures STUB_TR_REUSE_RC=1
check "a REUSED line on an exit of 1 is still a finding" 1 "$RC" "ci: FAILED — check-figures"
run_recorded TRACK_RECORD_TOKEN=t STUB_TR_REUSE=check-figures STUB_TR_REUSE_RC=2
check "a REUSED line on an exit of 2 is still a could-not-run" 2 "$RC" \
	"ci: LINTER ERROR (2) — check-figures could not run"
# A wrapped gate whose exit never came back is not a pass, though the wrapped
# gate before it passed.
run_recorded TRACK_RECORD_TOKEN=t STUB_TR_KILL=check-paths
check "a wrapped gate whose exit was lost could not run" 2 "$RC" "ci: LINTER ERROR (2) — check-paths could not run"

# THE KEY SEES THE INSTALL AND THE IGNORED FILES. The stub digests what each
# call's tools print, which is what track-record keys on. npm's record of the
# install moves it, and so does an ignored entry in scope: a file by its name
# and content, a symlink by its target and never by what it points at, and
# another repository by its name. What `npm ci`, a console's build and Claude
# Code write while a run is under way does not, and nothing in scope makes a
# tool fail. The ignores are the tree's own, and one that ignores Claude Code's
# worktrees directory whole, so that git lists each worktree in it as an entry.
stub_repo 0
printf 'node_modules\ndist/\n.claude/worktrees/*\n' > "$R/.gitignore"
printf '**/.claude/worktrees/\n*.gen\n.claude/*.lock\n' >> "$R/.git/info/exclude"
mkdir -p "$R/node_modules" "$R/src" "$R/.claude"
printf '{"packages":{"node_modules/a":{"version":"1.0.0"}}}\n' > "$R/node_modules/.package-lock.json"
printf '{}\n' > "$R/.claude/settings.json"
git -C "$R" add -A
: > "$WORK/toolfails"
key_of() { # <label> — check-figures' digest, kept under the label
	run_recorded TRACK_RECORD_TOKEN=t STUB_TR_DIGEST=1
	grep '^digest|check-figures|' "$TRLOG" > "$WORK/key.$1"
	grep '^toolfail|check-figures|' "$TRLOG" >> "$WORK/toolfails" || true
}
same_key() { # <label> <label>
	if cmp -s "$WORK/key.$1" "$WORK/key.$2"; then echo "same key"; else echo "new key"; fi > "$WORK/.key"
	OUT="$WORK/.key"
}
key_of base
printf '{"packages":{"node_modules/a":{"version":"2.0.0"}}}\n' > "$R/node_modules/.package-lock.json"
key_of install
same_key base install
check "an install from another lock is a new key" 0 "$RC" "new key"
printf 'export {}\n' > "$R/src/generated.ts"
printf 'src/generated.ts\n' >> "$R/.git/info/exclude"
key_of ignored
same_key install ignored
check "an ignored file is a new key" 0 "$RC" "new key"
printf 'export const generated = 1\n' > "$R/src/generated.ts"
key_of edited
same_key ignored edited
check "an ignored file's content is a new key" 0 "$RC" "new key"
mv "$R/src/generated.ts" "$R/src/renamed.ts"
printf 'src/renamed.ts\n' >> "$R/.git/info/exclude"
key_of renamed
same_key edited renamed
check "an ignored file's name is a new key" 0 "$RC" "new key"
mkdir -p "$R/test/fixtures/dist"
printf 'export const table = []\n' > "$R/test/fixtures/dist/table.ts"
key_of dist
same_key renamed dist
check "an ignored file under a dist/ outside a console is a new key" 0 "$RC" "new key"
mkdir -p "$R/test/fixtures/node_modules/m"
printf 'module.exports = 1\n' > "$R/test/fixtures/node_modules/m/index.js"
key_of nested
same_key dist nested
check "an ignored file under a nested node_modules is a new key" 0 "$RC" "new key"
ln -s ../test "$R/src/tests.gen"
key_of linked
same_key nested linked
check "an ignored symlink to a directory is a new key" 0 "$RC" "new key"
rm "$R/src/tests.gen"
ln -s ../nowhere "$R/src/tests.gen"
key_of relinked
same_key linked relinked
check "an ignored symlink's target is a new key, though it names nothing" 0 "$RC" "new key"
printf 'one\n' > "$WORK/outside.txt"
ln -s ../../outside.txt "$R/src/outside.gen"
key_of pointing
printf 'two\n' > "$WORK/outside.txt"
key_of followed
same_key pointing followed
check "what an ignored symlink points at is not followed" 0 "$RC" "same key"
mkdir -p "$R/scratch"
printf 'scratch/\n' >> "$R/.git/info/exclude"
git init -q "$R/scratch/other"
key_of repository
same_key followed repository
check "another repository that is ignored is a new key" 0 "$RC" "new key"
printf 'secret\n' > "$R/src/sealed.gen"
chmod 000 "$R/src/sealed.gen"
key_of sealed
same_key repository sealed
check "an ignored file it cannot read is a new key" 0 "$RC" "new key"
mkdir -p "$R/node_modules/.vite" "$R/ui/console/dist" "$R/ui/chuggy-ui/node_modules/.vite" \
	"$R/test/rig/node_modules/r"
printf 'cache\n' > "$R/node_modules/.vite/deps.json"
printf 'built\n' > "$R/ui/console/dist/index.html"
printf 'cache\n' > "$R/ui/chuggy-ui/node_modules/.vite/deps.json"
printf 'module.exports = 1\n' > "$R/test/rig/node_modules/r/index.js"
printf 'lock\n' > "$R/.claude/scheduled_tasks.lock"
git init -q "$R/.claude/worktrees/agent"
key_of written
same_key sealed written
check "what npm, a console's build and Claude Code write is the same key" 0 "$RC" "same key"
OUT="$WORK/toolfails"
refute "nothing in scope makes a tool fail" 0 0 "toolfail|"
# An install npm kept no record of is one no key can hold, so the tool that
# reads the record fails and leaves the gate unrecorded.
mv "$R/node_modules/.package-lock.json" "$WORK/install-record"
run_recorded TRACK_RECORD_TOKEN=t STUB_TR_DIGEST=1
OUT="$TRLOG"
check "an install with no record fails the tool that reads it" 0 "$RC" \
	"toolfail|check-figures|$record_tool_install"
mv "$WORK/install-record" "$R/node_modules/.package-lock.json"

# The listing prints names and hashes on stdout alike, so a name is keyed even
# where stderr cannot be opened; a listing that fails fails the tool rather
# than reading as a tree with nothing ignored; and the workspaces whose
# node_modules it leaves out are the ones package.json declares.
set +e
(cd "$R" && sh .chug/tasks/_ignored-inputs.sh 2>&-) > "$WORK/.raw"
RC=$?
set -e
tr '\0' '\n' < "$WORK/.raw" > "$WORK/.listing"
OUT="$WORK/.listing"
check "an ignored file's name is on the listing's stdout" 0 "$RC" "src/renamed.ts"
set +e
(cd "$BARE" && sh "$IGNORED") > "$WORK/.raw" 2>&1
RC=$?
set -e
OUT="$WORK/.raw"
check "a listing that fails fails the tool" 128 "$RC" "not a git repository"
declared="$(node -p "require('$ROOT/package.json').workspaces.slice().sort().join(' ')")"
listed="$(sed -n 's/^workspaces="\(.*\)"$/\1/p' "$IGNORED" | tr ' ' '\n' | LC_ALL=C sort | tr '\n' ' ')"
printf 'declared %s|\nlisted %s|\n' "$declared" "${listed% }" > "$WORK/.workspaces"
OUT="$WORK/.workspaces"
check "the workspaces left out are package.json's" 0 0 "listed $declared|"

# A PASS STANDS UNTIL WHAT ITS GATE READS MOVES. Against the stub's store, a
# first run records every gate and the same tree again reuses each. Then each
# change below reruns the gates that read it and reuses the model's, which
# reads the model, its own script, quint's installed closure, node and the
# salt alone: no source or console change, page under the model, package
# quint does not reach, ignored file outside the model, sequencer change or
# other base reruns it. Every gate is selected, by a base that does not
# resolve, so a gate that does not rerun is one reused rather than skipped.
stored_repo() {
	stub_repo 0
	mkdir -p "$R/model" "$R/ui/chuggy-ui" "$R/src" "$R/test" "$R/node_modules"
	printf 'module m {}\n' > "$R/model/m.qnt"
	printf '# the model\n' > "$R/model/README.md"
	printf 'export {}\n' > "$R/ui/chuggy-ui/a.ts"
	printf 'export {}\n' > "$R/src/a.ts"
	printf 'node_modules\n*.log\n' > "$R/.gitignore"
	lock_json 0.32.0 1.0.0 4.0.0 1.0.0 > "$R/node_modules/.package-lock.json"
	commit_all baseline
}
# The run against the store, as $OUT: a line for each gate that ran and each
# one reused, `ran <id>|` and `reused <id>|`, the stubs printing their file's
# name and track-record the gate's id.
run_stored() { # [VAR=value...]
	run_recorded TRACK_RECORD_TOKEN=t STUB_TR_STORE="$WORK/store" CHUG_CI_BASE=no-such-base "$@"
	{
		printf 'rc %s\n' "$RC"
		sed -n 's/^stub \([a-z-]*\)$/ran \1|/p' "$OUT"
		sed -n 's/^track-record: REUSED \([^ ]*\) .*/reused \1|/p' "$OUT"
	} > "$WORK/.stored"
	cp "$OUT" "$WORK/.stored-run"
	OUT="$WORK/.stored"
}
rm -rf "$WORK/store"
mkdir -p "$WORK/store"
stored_repo
run_stored
check "a first run runs the model's gate" 0 "$RC" "ran check-model|"
refute "a first run reuses nothing" 0 "$RC" "reused "
run_stored
check "the same tree again reuses the model's gate" 0 "$RC" "reused check-model|"
refute "the same tree again runs no wrapped gate" 0 "$RC" "ran check-model|"
printf 'gates run %s|\n' "$(grep -c '^ran ' "$OUT" || true)" >> "$OUT"
check "the same tree again runs only the gates no key wraps" 0 "$RC" "gates run 2|"
# A change, committed where git tracks any of it.
commit_any() { # <message>
	git -C "$R" add -A
	git -C "$R" diff --cached --quiet || git -C "$R" commit -qm "$1"
}
# Each change and the gates it must rerun.
stored_change() { # <label> <id that must rerun>...
	stored_label="$1"
	shift
	commit_any "$stored_label"
	run_stored
	check "$stored_label reuses the model's gate" 0 "$RC" "reused check-model|"
	for stored_id do
		check "$stored_label reruns $stored_id" 0 "$RC" "ran $stored_id|"
	done
}
printf 'export const a = 1\n' > "$R/ui/chuggy-ui/a.ts"
stored_change "a console change" check-console check-source
OUT="$WORK/.stored"
check "a console change reuses the server's gate" 0 "$RC" "reused check-postgres|"
printf 'export const a = 1\n' > "$R/src/a.ts"
stored_change "a source change" check-postgres check-keto
printf '# the model, read\n' > "$R/model/README.md"
stored_change "a page under the model" check-conformance
OUT="$WORK/.stored"
check "a page under the model reuses its generated API" 0 "$RC" "reused check-model-api|"
lock_json 0.32.0 1.0.0 4.0.0 1.0.1 > "$R/node_modules/.package-lock.json"
stored_change "an install that moves a package quint does not reach" check-console check-postgres
OUT="$WORK/.stored"
check "an install that leaves the schema library alone reuses the replay" 0 "$RC" "reused check-conformance|"
printf 'built\n' > "$R/src/build.log"
stored_change "an ignored file outside the model" check-figures
OUT="$WORK/.stored"
check "an ignored file outside the replay's inputs reuses it" 0 "$RC" "reused check-conformance|"
check "an ignored file within the server gate's inputs reruns it" 0 "$RC" "ran check-postgres|"
printf '# a sequencer comment\n' >> "$R/.chug/tasks/ci.sh"
stored_change "a sequencer change" check-figures
run_recorded TRACK_RECORD_TOKEN=t STUB_TR_STORE="$WORK/store" CHUG_CI_BASE=HEAD~3
OUT="$WORK/.out"
check "another base reuses the model's gate" 0 "$RC" "track-record: REUSED check-model ("
lock_json 0.32.0 1.0.0 4.0.0 1.0.1 flags > "$R/node_modules/.package-lock.json"
stored_change "an install that flips the flags npm derives" check-console
lock_json 0.32.0 1.0.0 4.0.0 1.0.1 hoisted > "$R/node_modules/.package-lock.json"
stored_change "an install that moves where quint's copy of a package sits" check-console
# A setting left at the root is keyed rather than refused, since no pathspec
# holds it, and a package arriving above the sources moves the replays,
# though none of their pathspecs holds it either.
printf '[*]\nindent_style = tab\n' > "$R/.editorconfig"
run_stored CHUG_CI_ALLOW_UNTRACKED=1
check "a setting left at the root reruns the console" 0 "$RC" "ran check-console|"
check "a setting left at the root reuses the model's gate" 0 "$RC" "reused check-model|"
run_stored CHUG_CI_ALLOW_UNTRACKED=1
check "the console's pass beside a setting left at the root is reused" 0 "$RC" "reused check-console|"
stored_change "a setting committed as it was left" check-figures
OUT="$WORK/.stored"
check "a setting committed as it was left reuses the console" 0 "$RC" "reused check-console|"
mkdir -p "$R/src/node_modules/zod"
printf 'module.exports = {};\n' > "$R/src/node_modules/zod/index.js"
stored_change "a package arriving above the sources" check-conformance check-random check-console
# What it reads, each on its own, reruns it.
stored_rerun() { # <label> [VAR=value...]
	stored_label="$1"
	shift
	commit_any "$stored_label"
	run_stored "$@"
	check "$stored_label reruns the model's gate" 0 "$RC" "ran check-model|"
}
printf 'module m { val x = 1 }\n' > "$R/model/m.qnt"
stored_rerun "a model change"
OUT="$WORK/.stored"
check "a model change reuses the server's gate" 0 "$RC" "reused check-postgres|"
printf '# a gate comment\n' >> "$R/.chug/tasks/check-model.sh"
stored_rerun "the gate's own script"
OUT="$WORK/.stored"
check "the model's script reuses its generated API" 0 "$RC" "reused check-model-api|"
lock_json 0.32.0 1.1.0 4.0.0 1.0.1 > "$R/node_modules/.package-lock.json"
stored_rerun "an install that moves a package quint depends on"
OUT="$WORK/.stored"
check "an install that moves quint's closure reuses the replay" 0 "$RC" "reused check-conformance|"
lock_json 0.33.0 1.1.0 4.0.0 1.0.1 > "$R/node_modules/.package-lock.json"
stored_rerun "an install that moves quint"
printf 'model/gen.qnt\n' >> "$R/.git/info/exclude"
printf 'module g {}\n' > "$R/model/gen.qnt"
stored_rerun "an ignored file among the model's"
sed 's/^record_salt=.*/record_salt="another-salt"/' "$R/.chug/tasks/ci.sh" > "$WORK/.salted"
cat "$WORK/.salted" > "$R/.chug/tasks/ci.sh"
stored_rerun "a new salt"
# A key it cannot take is never recorded, and so never reused: an untracked
# file among its inputs, or a tool that fails.
printf 'module n {}\n' > "$R/model/n.qnt"
run_stored CHUG_CI_ALLOW_UNTRACKED=1
run_stored CHUG_CI_ALLOW_UNTRACKED=1
check "a model holding an untracked file is never reused" 0 "$RC" "ran check-model|"
rm "$R/model/n.qnt"
printf 'module m { val y = 1 }\n' > "$R/model/m.qnt"
commit_all "a model change under a lock that cannot be read"
printf 'not a lock\n' > "$R/node_modules/.package-lock.json"
run_stored
run_stored
check "a model keyed through a tool that fails is never reused" 0 "$RC" "ran check-model|"
lock_json 0.33.0 1.1.0 4.0.0 1.0.1 > "$R/node_modules/.package-lock.json"

# A closure is found where node finds each package: a copy npm nested under
# the package that asks for it before the one at the root, a workspace through
# its link, and a dependency installed nowhere printed as absent. Each package
# is printed by what it is and each one asked for by what the asker gets. A
# record that holds no package named fails, and so do a call that names none
# and a record that holds no packages at all.
closure_lock() { # <b's flags> <where a's copy of b is> <where w's copy of b is>
	printf '{ "packages": {\n'
	printf '  "": { "dependencies": { "a": "1" } },\n'
	printf '  "node_modules/a": { "version": "1.0.0", "integrity": "sha512-a"%s,\n' "$1"
	printf '    "dependencies": { "b": "^2", "w": "*", "gone": "1" } },\n'
	printf '  "%s": { "version": "2.0.0", "integrity": "sha512-b2"%s },\n' "$2" "$1"
	printf '  "%s": { "version": "1.0.0", "integrity": "sha512-b1"%s },\n' "$3" "$1"
	printf '  "node_modules/w": { "resolved": "ws/w", "link": true },\n'
	printf '  "ws/w": { "name": "w", "version": "0.0.1", "dependencies": { "b": "1" } },\n'
	printf '  "node_modules/unreached": { "version": "9.0.0", "integrity": "sha512-u" }\n'
	printf '} }\n'
}
closure_of() { # <lock> <label> — a's closure, as $OUT and kept under the label
	set +e
	sh "$INSTALLED" --lock "$1" a > "$WORK/.closure" 2>&1
	RC=$?
	set -e
	cp "$WORK/.closure" "$WORK/closure.$2"
	OUT="$WORK/.closure"
}
closure_lock "" node_modules/a/node_modules/b node_modules/b > "$WORK/lock.json"
closure_of "$WORK/lock.json" nested
check "a package is what it is" 0 "$RC" "a@1.0.0 sha512-a"
check "a nested copy is the one its package gets" 0 "$RC" "a@1.0.0 sha512-a > b b@2.0.0 sha512-b2"
check "a workspace is followed through its link" 0 "$RC" "a@1.0.0 sha512-a > w w@0.0.1 ws/w"
check "a workspace gets the copy at the root" 0 "$RC" "w@0.0.1 ws/w > b b@1.0.0 sha512-b1"
check "a dependency installed nowhere is printed absent" 0 "$RC" "a@1.0.0 sha512-a > gone absent"
refute "a package nothing named depends on is left out" 0 "$RC" "unreached"
refute "no package is printed by where it is installed" 0 "$RC" "node_modules/"
# What npm derives and where it put a copy move nothing; a package that gets
# another copy does, though the same copies are installed.
closure_lock ', "dev": true, "peer": true' node_modules/a/node_modules/b node_modules/b > "$WORK/lock.json"
closure_of "$WORK/lock.json" flags
closure_lock "" node_modules/b ws/w/node_modules/b > "$WORK/lock.json"
closure_of "$WORK/lock.json" hoisted
closure_lock "" node_modules/b node_modules/a/node_modules/b > "$WORK/lock.json"
closure_of "$WORK/lock.json" swapped
for closure in flags hoisted swapped; do
	if cmp -s "$WORK/closure.nested" "$WORK/closure.$closure"; then
		echo "same closure"
	else
		echo "new closure"
	fi > "$WORK/.same"
	OUT="$WORK/.same"
	case "$closure" in
	swapped) check "a package that gets another installed copy is a new closure" 0 0 "new closure" ;;
	*) check "a lock that records b $closure is the same closure" 0 0 "same closure" ;;
	esac
done
# Optional and peer dependencies are followed as plain ones are, and a link
# whose target the record does not hold is the place it points at.
printf '{ "packages": {
  "node_modules/a": { "version": "1.0.0", "integrity": "sha512-a", "dependencies": { "l": "*" },
    "optionalDependencies": { "o": "1" }, "peerDependencies": { "p": "1" } },
  "node_modules/o": { "version": "3.0.0", "integrity": "sha512-o" },
  "node_modules/p": { "version": "4.0.0", "integrity": "sha512-p" },
  "node_modules/l": { "resolved": "../outside/l", "link": true }
} }\n' > "$WORK/asked.json"
closure_of "$WORK/asked.json" asked
check "an optional dependency is followed" 0 "$RC" "a@1.0.0 sha512-a > o o@3.0.0 sha512-o"
check "a peer dependency is followed" 0 "$RC" "a@1.0.0 sha512-a > p p@4.0.0 sha512-p"
check "a link the record holds no target for is where it points" 0 "$RC" \
	"a@1.0.0 sha512-a > l l link ../outside/l"
OUT="$WORK/.closure"
set +e
sh "$INSTALLED" --lock "$WORK/lock.json" a nope > "$WORK/.closure" 2>&1
RC=$?
set -e
check "a record holding no package named fails" 1 "$RC" "holds no nope"
set +e
sh "$INSTALLED" --lock "$WORK/lock.json" > "$WORK/.closure" 2>&1
RC=$?
set -e
check "a call naming no package could not run" 2 "$RC" "name a package"
printf '{ "lockfileVersion": 3 }\n' > "$WORK/bare-lock.json"
set +e
sh "$INSTALLED" --lock "$WORK/bare-lock.json" a > "$WORK/.closure" 2>&1
RC=$?
set -e
check "a record that holds no packages fails" 1 "$RC" "holds no packages"

# A place a tool looks is described whatever git makes of what is there, a
# file tracked, untracked or ignored each by its content, and a place that
# holds nothing prints nothing. A call that names none could not run, and a
# listing git cannot make fails rather than reading as places holding nothing.
stub_repo 0
printf 'node_modules\n' > "$R/.gitignore"
printf 'root = true\n' > "$R/.editorconfig"
commit_all baseline
printf '{}\n' > "$R/.prettierrc"
mkdir -p "$R/src/node_modules/zod"
printf 'module.exports = {};\n' > "$R/src/node_modules/zod/index.js"
set +e
(cd "$R" && sh .chug/tasks/_probed-inputs.sh .editorconfig .prettierrc .npmrc src/node_modules) \
	> "$WORK/.raw" 2>&1
RC=$?
set -e
tr '\0' '\n' < "$WORK/.raw" > "$WORK/.probed"
OUT="$WORK/.probed"
for place in .editorconfig .prettierrc src/node_modules/zod/index.js; do
	check "$place, where a tool looks, is described" 0 "$RC" "$place"
	check "$place is described by its content" 0 "$RC" "$(git -C "$R" hash-object -- "$place")"
done
refute "a place that holds nothing prints nothing" 0 "$RC" ".npmrc"
set +e
(cd "$R" && sh .chug/tasks/_probed-inputs.sh) > "$WORK/.probed" 2>&1
RC=$?
set -e
check "a call naming no place could not run" 2 "$RC" "name a path"
echo garbage > "$R/.git/index"
set +e
(cd "$R" && sh .chug/tasks/_probed-inputs.sh .editorconfig) > "$WORK/.probed" 2>&1
RC=$?
set -e
check "a listing of the places that fails fails the tool" 128 "$RC" "index file"

# A wrapped suite still has its cap.
stub_repo 0
printf '#!/bin/sh\nexec sleep 5\n' > "$R/.chug/tasks/slow.test.sh"
git -C "$R" add -A
run_recorded TRACK_RECORD_TOKEN=t CHUG_CI_SHELL_SUITES=1 CHUG_CI_SUITE_TIMEOUT_SECS=1
check "a wrapped suite past its cap fails the run" 1 "$RC" "slow.test.sh ran past the 1s cap"

OUT="$BARE/.out"
set +e
(cd "$BARE" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "ci.test.sh"
