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
IMPORT_GRAPH="$HERE/_import-graph.sh"
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
	TRACK_RECORD_FRESH TRACK_RECORD_OFF CHUG_CI_QUIET CHUG_CI_TAIL_LINES

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
	cp "$IMPORT_GRAPH" "$R/.chug/tasks/_import-graph.sh"
	cp "$HERE/_unit-suites.sh" "$R/.chug/tasks/_unit-suites.sh"
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
check "a docs-only change skips the agents' lag behind npm" 0 "$RC" "check-agent-lag: SKIPPED"
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
check "a source-only change skips the agents' lag behind npm" 0 "$RC" "check-agent-lag: SKIPPED"
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
check "a model change beside a changed page still skips the console's copy" 0 "$RC" \
	"check-console-copy: SKIPPED"

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

# A GATE THAT RUNS ITSELF IS SELECTED BY WHAT IT DECLARES TOO: check-agent-lag
# by the worker image's directory and its own script.
stub_repo 0
commit_all baseline
for path in images/worker/Dockerfile images/worker/core.json .chug/tasks/check-agent-lag.sh; do
	mkdir -p "$R/$(dirname "$path")"
	printf '# changed\n' >> "$R/$path"
	commit_all "$path"
	run_last_commit
	check "$path selects check-agent-lag" 0 "$RC" "stub check-agent-lag"
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
# The commit the ticket package resolves to, a git dependency as the tree's is.
lock_ticket=1
lock_json() { # <quint> <grpc> <zod> <left-pad> [flags | hoisted]
	lock_dev=', "dev": true'
	lock_long=node_modules/long
	case "${5:-}" in
	flags) lock_dev="" ;;
	hoisted) lock_long=node_modules/@grpc/grpc-js/node_modules/long ;;
	esac
	printf '{\n  "lockfileVersion": 3,\n  "packages": {\n'
	printf '    "": { "devDependencies": { "@informalsystems/quint": "%s", "zod": "%s", "prettier": "3.0.0", "left-pad": "%s", "@kasofsk/chug-ticket-domain": "github:kasofsk/chug-ticket-domain", "@fluent/syntax": "0.19.0" } },\n' "$1" "$3" "$4"
	printf '    "node_modules/@kasofsk/chug-ticket-domain": { "version": "0.7.0", "resolved": "git+ssh://git@github.com/kasofsk/chug-ticket-domain.git#%s"%s },\n' "$lock_ticket" "$lock_dev"
	printf '    "node_modules/@informalsystems/quint": { "version": "%s", "integrity": "sha512-quint-%s"%s, "dependencies": { "@grpc/grpc-js": "^%s" } },\n' "$1" "$1" "$lock_dev" "$2"
	printf '    "node_modules/@grpc/grpc-js": { "version": "%s", "integrity": "sha512-grpc-%s"%s, "dependencies": { "long": "^5" } },\n' "$2" "$2" "$lock_dev"
	printf '    "%s": { "version": "5.0.0", "integrity": "sha512-long-5"%s },\n' "$lock_long" "$lock_dev"
	if [ "${5:-}" = hoisted ]; then
		printf '    "node_modules/long": { "version": "4.0.0", "integrity": "sha512-long-4"%s },\n' "$lock_dev"
	fi
	printf '    "node_modules/zod": { "version": "%s", "integrity": "sha512-zod-%s"%s },\n' "$3" "$3" "$lock_dev"
	printf '    "node_modules/prettier": { "version": "3.0.0", "integrity": "sha512-prettier-3"%s },\n' "$lock_dev"
	printf '    "node_modules/@fluent/syntax": { "version": "0.19.0", "integrity": "sha512-fluent-syntax-0"%s },\n' "$lock_dev"
	printf '    "node_modules/left-pad": { "version": "%s", "integrity": "sha512-left-pad-%s"%s }\n' "$4" "$4" "$lock_dev"
	printf '  }\n}\n'
}

# The console is a workspace the root lockfile pins, and npm reads every
# workspace's manifest before it runs a script in one. A format script, where
# it declares one, takes Prettier's settings and what Prettier leaves out from
# the root, and its bundler takes the root's compiler settings for the contract
# it imports. The replays run under the module type the nearest manifest above
# each file declares, the schema library the lockfile pins, which the
# generated API imports, and the ticket package whose traces they replay, and no
# other package: a lock that moves another leaves them out.
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
lock_ticket=2
lock_json 0.32.0 1.0.0 4.0.1 1.0.1 > "$R/package-lock.json"
commit_all ticket-package
run_last_commit
check "a lockfile that moves the ticket package selects the replay" 0 "$RC" "stub check-conformance"
check "a lockfile that moves the ticket package selects the random replay" 0 "$RC" "stub check-random"
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
text_gates="doc-lint check-figures check-paths check-shell-quoting check-console-sheets check-gates check-comments"
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

# THE MODEL'S GATE FOLLOWS QUINT AND THE TICKET PACKAGE: a lock that moves no
# package in their closure leaves it out, and one that moves either or a package
# quint depends on brings it in, read past any colour or diff program git is configured with. A
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
lock_ticket=3
lock_json 0.33.0 1.1.0 4.0.0 1.0.2 > "$R/package-lock.json"
commit_all ticket-package
run_last_commit
refute "a lock that moves the ticket package selects Quint" 0 "$RC" "check-model: SKIPPED"
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
# Many run at once, so each keeps its own scratch files and writes each of its
# lines to the log whole.
log() { stub_line="$(printf "$@")"; printf '%s\n' "$stub_line" >>"$STUB_TR_LOG"; }
log '%s|' "$@"
log 'env|FRESH=%s|URL=%s|NAMESPACE=%s|' "${TRACK_RECORD_FRESH-unset}" \
	"${TRACK_RECORD_URL-unset}" "${TRACK_RECORD_NAMESPACE-unset}"
name=""
tools=""
specs=""
keyed=1
scratch="$STUB_TR_LOG.$$"
material="$scratch.material"
: >"$material"
while [ "$#" -gt 0 ]; do
	case "$1" in
	--) shift; break ;;
	--name) name="$2"; printf 'name %s\n' "$2" >>"$material"; shift 2 ;;
	--inputs) specs="$specs$2
"; shift 2 ;;
	--tool)
		if [ -n "${STUB_TR_DIGEST:-}${STUB_TR_STORE:-}" ]; then
			if ! sh -c "$2" >"$scratch.out" 2>"$scratch.err"; then
				log 'toolfail|%s|%s' "$name" "$2"
				keyed=0
			fi
			tools="$tools$(cksum <"$scratch.out") $(cksum <"$scratch.err")/"
			printf 'tool %s\n' "$2" >>"$material"
			cat "$scratch.out" "$scratch.err" >>"$material"
		fi
		shift 2
		;;
	--env) printf 'env %s %s\n' "$2" "$(printenv "$2" || echo '(unset)')" >>"$material"; shift 2 ;;
	--salt) printf 'salt %s\n' "$2" >>"$material"; shift 2 ;;
	--platform) printf 'platform %s\n' "$(uname -sm)" >>"$material"; shift ;;
	*) shift ;;
	esac
done
if [ -n "${STUB_TR_DIGEST:-}" ]; then log 'digest|%s|%s' "$name" "$tools"; fi
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
log 'key|%s|%s|%s' "$name" "$key" "$keyed"
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
# Every gate the sequencer names is wrapped but check-roster, doc-lint and
# check-agent-lag.
gate_calls="$(named_gates "$SUT" | grep -vcx -e check-roster -e doc-lint -e check-agent-lag)"

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
# track-record that does not run, with no record directory, and with
# TRACK_RECORD_OFF=1, the run is the one it is with no track-record at all but
# for one line, which names the first reason and never the token.
fresh_line="ci: every gate runs fresh, and no pass on record is reused: "
stub_repo 0
run_gates_only
grep -vF "$fresh_line" "$OUT" > "$WORK/.plain"
check "a plain run says it reuses nothing, and why" 0 "$RC" "${fresh_line}no Track Record token"
printf ' \n' > "$WORK/blank-token"
for case in "no token|no Track Record token|" \
	"a token file that is not there|TRACK_RECORD_TOKEN_FILE names no readable file holding a token|TRACK_RECORD_TOKEN_FILE=$WORK/absent-token" \
	"a token file that holds none|TRACK_RECORD_TOKEN_FILE names no readable file holding a token|TRACK_RECORD_TOKEN_FILE=$WORK/blank-token" \
	"a track-record that does not run|no track-record that runs|TRACK_RECORD_TOKEN=trk_secret STUB_TR_VERSION_RC=1" \
	"no record directory|no record directory could be made|TRACK_RECORD_TOKEN=trk_secret TMPDIR=$WORK/absent-tmp" \
	"TRACK_RECORD_OFF=1|TRACK_RECORD_OFF=1|TRACK_RECORD_TOKEN=trk_secret TRACK_RECORD_OFF=1"; do
	name="${case%%|*}" rest="${case#*|}"
	reason="${rest%%|*}"
	# shellcheck disable=SC2086 # the case's assignments are words by construction
	run_recorded ${rest#*|}
	check "$name says every gate runs fresh, and why" 0 "$RC" "$fresh_line$reason"
	refute "$name prints no token" 0 "$RC" "trk_secret"
	if [ "$(grep -cF "$fresh_line" "$OUT")" = 1 ] && grep -vF "$fresh_line" "$OUT" | cmp -s - "$WORK/.plain"; then
		echo "same output" >> "$OUT"
	fi
	check "$name leaves the rest of the run as it is with no track-record" 0 "$RC" "same output"
	recorded_log
	check "$name wraps nothing" 0 "$RC" "calls 0"
done

# A token, in the variable or in a file, wraps every gate the sequencer calls
# once but check-roster, doc-lint and check-agent-lag, named by its id, keyed
# on node and the salt and on what else its verdict reads, and never on the
# platform. Those three run as they do unwrapped.
printf 'trk_stub\n' > "$WORK/token"
run_recorded TRACK_RECORD_TOKEN_FILE="$WORK/token"
check "a token file wraps the run" 0 "$RC" "a pass on record at https://track-record.vteng.io (chuggy) is reused"
refute "a run that reuses says nothing of running fresh" 0 "$RC" "$fresh_line"
check "a wrapped clean run counts what it reused" 0 "$RC" "ci: all gates clean (0 reused)"
check "check-roster still runs" 0 "$RC" "stub check-roster"
check "doc-lint still runs" 0 "$RC" "stub doc-lint"
check "check-agent-lag still runs" 0 "$RC" "stub check-agent-lag"
recorded_log
check "every gate the sequencer calls is wrapped once" 0 "$RC" "calls $gate_calls"
refute "no gate is keyed on the platform" 0 "$RC" "|--platform|"
refute "check-roster is not wrapped" 0 "$RC" "run|--name|check-roster|"
refute "doc-lint is not wrapped" 0 "$RC" "run|--name|doc-lint|"
refute "check-agent-lag is not wrapped" 0 "$RC" "run|--name|check-agent-lag|"
check "the store defaults to the shared one" 0 "$RC" "env|FRESH=unset|URL=https://track-record.vteng.io|NAMESPACE=chuggy|"
# A gate keyed on the whole tree holds the whole install record and every
# ignored file, and passes no inputs. The server gates are among them here,
# since this fixture holds no depcruise to build their import graph with.
common="--tool|$record_tool_node|--tool|$record_tool_install|--tool|$record_tool_ignored|--salt|$salt|"
keyed=0
for gate in \
	"check-paths|${common}--tool|git log --diff-filter=D --name-only --format=|--|./.chug/tasks/check-paths.sh|" \
	"source-static|--|./.chug/tasks/check-source.sh|--static|" \
	"source-unit|${common}--env|CHUG_SETUP_PROGRAM|--|./.chug/tasks/check-source.sh|--unit|" \
	"check-postgres|${common}--env|CHUG_PG_URL|--env|CHUG_PG_IMAGE|--|./.chug/tasks/check-postgres.sh|" \
	"check-queries|${common}--env|CHUG_PG_URL|--env|CHUG_PG_IMAGE|--|./.chug/tasks/check-queries.sh|" \
	"check-keto|${common}--env|CHUG_KETO_READ_URL|--env|CHUG_KETO_WRITE_URL|--env|CHUG_KETO_IMAGE|--env|CHUG_PG_URL|--env|CHUG_PG_IMAGE|--|./.chug/tasks/check-keto.sh|"; do
	id="${gate%%|*}"
	shape="${gate#*|}"
	case "$shape" in --\|*) shape="$common$shape" ;; esac
	check "$id is keyed on the whole tree and what else its verdict reads" 0 "$RC" "run|--name|$id|$shape"
	case "$shape" in "$common--|"*) ;; *) keyed=$((keyed + 1)) ;; esac
done
# The model's gate holds its model, its script and the installed closure of
# quint and the ticket package, and the ignored files among them, and nothing
# else of the tree.
check "check-model is keyed on the model, its script, quint and the ticket package alone" 0 "$RC" \
	"run|--name|check-model|--tool|$record_tool_node|--tool|$record_tool_installed '@informalsystems/quint' '@kasofsk/chug-ticket-domain'|--tool|$record_tool_ignored ':(glob)model/**/*.qnt' '.chug/tasks/check-model.sh'|--inputs|:(glob)model/**/*.qnt|--inputs|.chug/tasks/check-model.sh|--salt|$salt|--|./.chug/tasks/check-model.sh|"
# Every other narrowed gate passes its inputs and scopes its ignored files to
# them; a gate that runs the root's toolchain broadly holds the whole install
# record, and one that runs named packages holds their closure.
narrowed=0
for gate in \
	"check-model|packages|--|./.chug/tasks/check-model.sh|" \
	"check-model-api|packages|--|./.chug/tasks/check-model-api.sh|" \
	"check-console-copy|packages|--|./.chug/tasks/check-console-copy.sh|" \
	"check-conformance|packages|--env|CHUG_GOLDEN_DIR|--|./.chug/tasks/check-conformance.sh|" \
	"check-random|packages|--env|CHUG_WALK_SAMPLES|--env|CHUG_WALK_SEED_BASE|--env|CHUG_WALK_SEED|--env|CHUG_WALK_INSTANCE|--|./.chug/tasks/check-random.sh|" \
	"check-console|install|--|./.chug/tasks/check-console.sh|"; do
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
# generated API the one above its generator, the console's copy gate the ones
# above its tool. The model's gate looks nowhere else, and a whole-tree key
# holds every place already.
for gate in \
	"check-console|'.editorconfig'|'.prettierrc'|':(glob)postcss.config.*'|'src/tsconfig.json'|'src/node_modules'" \
	"check-conformance|'src/node_modules'" "check-random|'src/node_modules'" \
	"check-model-api|'scripts/node_modules'" \
	"check-console-copy|'ui/chuggy-ui/tools/node_modules'|'ui/chuggy-ui/node_modules'"; do
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
check "no other gate holds a place a tool looks" 0 "$RC" "looking 5"
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
pin_scope check-model-api "$record_tool_installed '@informalsystems/quint' 'prettier' '@kasofsk/chug-ticket-domain'" \
	':(glob)model/**/*.qnt' scripts/generate-model-api.ts src/generated src/domain/generated \
	.chug/tasks/check-model-api.sh ':(glob)**/package.json' -- scripts/node_modules scripts/package.json
pin_scope check-console-copy "$record_tool_installed '@fluent/syntax'" ui/chuggy-ui/app/copy \
	ui/chuggy-ui/app/core/generated ui/chuggy-ui/tools/copyCatalog.ts .chug/tasks/check-console-copy.sh \
	':(glob)**/package.json' -- ui/chuggy-ui/tools/node_modules ui/chuggy-ui/tools/package.json \
	ui/chuggy-ui/node_modules ui/chuggy-ui/package.json
pin_scope check-conformance "$record_tool_installed 'zod' '@kasofsk/chug-ticket-domain'" src/domain src/generated test/conformance \
	test/domain test/itf test/golden model .chug/tasks/check-conformance.sh ':(glob)**/package.json' \
	-- src/node_modules src/package.json
pin_scope check-random "$record_tool_installed 'zod' '@kasofsk/chug-ticket-domain'" src/domain src/generated test/random \
	test/conformance test/domain test/itf model .chug/tasks/check-random.sh ':(glob)**/package.json' \
	-- src/node_modules src/package.json
pin_scope check-console "$record_tool_install" ui src/contract test/fixtures/configurations \
	.chug/configurations scripts/console-policy.ts scripts/check-console-policy.ts package-lock.json \
	tsconfig.json .gitignore .prettierrc.json .prettierignore .chug/tasks/check-console.sh \
	':(glob)**/package.json' -- .browserslistrc browserslist .editorconfig .npmrc .prettierrc \
	package.yaml lerna.json pnpm-workspace.yaml ':(glob).postcssrc*' ':(glob)postcss.config.*' \
	src/node_modules src/package.json src/tsconfig.json

run_recorded TRACK_RECORD_TOKEN=t TRACK_RECORD_URL=http://store.test TRACK_RECORD_NAMESPACE=elsewhere
recorded_log
check "the store and namespace can be named" 0 "$RC" "env|FRESH=unset|URL=http://store.test|NAMESPACE=elsewhere|"

# A full run asks every gate fresh, and still records; the variable alone
# does the same without forcing every gate.
run_recorded TRACK_RECORD_TOKEN=t CHUG_CI_FULL=1
check "a full run says it reuses nothing" 0 "$RC" "and none on record is reused"
refute "a run that only records says nothing of running fresh" 0 "$RC" "$fresh_line"
recorded_log
check "a full run wraps every gate" 0 "$RC" "calls $gate_calls"
refute "a full run asks no gate for a pass on record" 0 "$RC" "FRESH=unset"
run_recorded TRACK_RECORD_TOKEN=t TRACK_RECORD_FRESH=1
recorded_log
refute "TRACK_RECORD_FRESH=1 reaches every gate" 0 "$RC" "FRESH=unset"

# A gate the selection library does not name is keyed on the whole tree.
stub_repo 0
awk '{ print } /^run_selected_gate check-comments / {
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
pin_scope .chug/tasks/ci.test.sh "$record_tool_installed 'dependency-cruiser'" .chug/tasks/ci.test.sh \
	.chug/tasks/ci.sh .chug/tasks/_ci-select.sh .chug/tasks/_import-graph.sh .chug/tasks/_ignored-inputs.sh \
	.chug/tasks/_installed-inputs.sh .chug/tasks/_probed-inputs.sh .chug/tasks/_suite.sh \
	.chug/tasks/_unit-suites.sh .chug/tasks/check-source.sh .chug/tasks/_test-timeout.sh \
	scripts/unit-outcomes.ts .dependency-cruiser.cjs tsconfig.json justfile package.json
pin_scope .chug/tasks/check-source.test.sh "$record_tool_install" .chug/tasks/check-source.test.sh \
	.chug/tasks/check-source.sh .chug/tasks/_test-timeout.sh .chug/tasks/_suite.sh \
	.chug/tasks/_unit-suites.sh scripts/unit-outcomes.ts tsconfig.json tsconfig.contract.json \
	eslint.config.js .prettierrc.json .prettierignore package.json
pin_scope .chug/tasks/check-boundaries.test.sh "$record_tool_install" \
	.chug/tasks/check-boundaries.test.sh .chug/tasks/check-boundaries.sh .chug/tasks/_suite.sh \
	tsconfig.json .dependency-cruiser.cjs package.json
pin_scope .chug/tasks/check-duplication.test.sh "$record_tool_install" \
	.chug/tasks/check-duplication.test.sh .chug/tasks/check-duplication.sh .chug/tasks/_suite.sh \
	.jscpd.json package.json
pin_scope .chug/tasks/check-comments.test.sh "$record_tool_install" .chug/tasks/check-comments.test.sh \
	.chug/tasks/check-comments.sh .chug/tasks/_suite.sh package.json
pin_scope .chug/tasks/check-conformance.test.sh "$record_tool_installed 'zod' '@kasofsk/chug-ticket-domain'" \
	.chug/tasks/check-conformance.test.sh .chug/tasks/_suite.sh src/domain src/generated \
	test/conformance test/domain test/itf test/golden model .chug/tasks/check-conformance.sh \
	':(glob)**/package.json' -- src/node_modules src/package.json
pin_scope .chug/tasks/check-model-api.test.sh "$record_tool_installed '@informalsystems/quint' 'prettier' '@kasofsk/chug-ticket-domain'" \
	.chug/tasks/check-model-api.test.sh .chug/tasks/_suite.sh ':(glob)model/**/*.qnt' \
	scripts/generate-model-api.ts src/generated src/domain/generated .chug/tasks/check-model-api.sh \
	':(glob)**/package.json' -- scripts/node_modules scripts/package.json
pin_scope .chug/tasks/check-shell-quoting.test.sh "$record_tool_install"
grep "^run|--name|.chug/tasks/check-random.test.sh|" "$TRLOG" > "$WORK/.line" || true
OUT="$WORK/.line"
check "the random replay's suite, with no graph to read, is keyed on the whole tree" 0 "$RC" \
	"run|--name|.chug/tasks/check-random.test.sh|--tool|$record_tool_node|--tool|$record_tool_install|--tool|$record_tool_ignored|--salt|$salt|--platform|"
OUT="$WORK/.log"
pin_scope .chug/tasks/emit-goldens.test.sh "$record_tool_installed 'prettier' '@informalsystems/quint' '@kasofsk/chug-ticket-domain'" \
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
# The build npm installed for this machine is no part of a key, and the
# package that asks for it is: one lock installed on two machines is one key,
# and a build that moves with its package is a new one.
platform_lock() { # <a's version> <build> <cpu>
	printf '{"packages":{"node_modules/a":{"version":"%s","optionalDependencies":' "$1"
	printf '{"a-x64":"%s","a-arm64":"%s"}},' "$1" "$1"
	printf '"node_modules/%s":{"version":"%s","optional":true,"os":["linux"],"cpu":["%s"]}}}\n' \
		"$2" "$1" "$3"
}
platform_lock 2.0.0 a-x64 x64 > "$R/node_modules/.package-lock.json"
key_of x64
platform_lock 2.0.0 a-arm64 arm64 > "$R/node_modules/.package-lock.json"
key_of arm64
same_key x64 arm64
check "an install that differs only in this machine's build is the same key" 0 "$RC" "same key"
platform_lock 2.0.1 a-arm64 arm64 > "$R/node_modules/.package-lock.json"
key_of moved
same_key arm64 moved
check "a build that moves with the package asking for it is a new key" 0 "$RC" "new key"
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
check "the same tree again runs only the gates no key wraps" 0 "$RC" \
	"gates run $(($(named_gates "$SUT" | grep -c .) - gate_calls))|"
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
check "a console change reruns the server's gate, whose graph no depcruise here can build" 0 "$RC" \
	"ran check-postgres|"
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
check "a model change reuses the console's gate" 0 "$RC" "reused check-console|"
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
# The whole record is the record less each build for one platform, an entry
# stating an os, a cpu or a libc, wherever it is installed; the package asking
# for one stays. A call naming a package beside it could not run, and a record
# that cannot be read fails it as it fails a closure.
printf '{ "packages": {
  "node_modules/n": { "version": "1.0.0", "integrity": "sha512-n",
    "optionalDependencies": { "n-os": "1.0.0", "n-cpu": "1.0.0", "n-libc": "1.0.0" } },
  "node_modules/n-os": { "version": "1.0.0", "optional": true, "os": ["linux"] },
  "node_modules/n/node_modules/n-cpu": { "version": "1.0.0", "optional": true, "cpu": ["x64"] },
  "node_modules/n-libc": { "version": "1.0.0", "optional": true, "libc": ["glibc"] }
} }\n' > "$WORK/whole.json"
whole_of() { # <lock> [package...] — the whole record, as $OUT
	whole_lock="$1"
	shift
	set +e
	sh "$INSTALLED" --lock "$whole_lock" --whole "$@" > "$WORK/.whole" 2>&1
	RC=$?
	set -e
	OUT="$WORK/.whole"
}
whole_of "$WORK/whole.json"
check "the whole record keeps the package asking for a build" 0 "$RC" '"node_modules/n": {'
check "the whole record keeps what that package asks for" 0 "$RC" '"n-cpu": "1.0.0"'
for build in node_modules/n-os node_modules/n/node_modules/n-cpu node_modules/n-libc; do
	refute "the whole record leaves out $build" 0 "$RC" "\"$build\""
done
whole_of "$WORK/whole.json" n
check "a whole record naming a package could not run" 2 "$RC" "nothing follows --whole"
printf 'not a lock\n' > "$WORK/broken-lock.json"
whole_of "$WORK/broken-lock.json"
check "a whole record that cannot be read fails" 1 "$RC" "cannot be read"
whole_of "$WORK/bare-lock.json"
check "a whole record that holds no packages fails" 1 "$RC" "holds no packages"

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

# A QUIET RUN PRINTS VERDICTS, NOT TRANSCRIPTS. A gate's output is in its log,
# a clean gate is one line, a red one shows the end of its log, and the run
# ends on every red one, past which it carries on.
ci_with() { # [VAR=value...] [-- <ci.sh argument>...]
	OUT="$WORK/.out"
	ci_env=""
	while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
		ci_env="$ci_env $(printf '%s' "$1")"
		shift
	done
	[ "$#" -eq 0 ] || shift
	set +e
	# shellcheck disable=SC2086
	(cd "$R" && env CHUG_CI_SHELL_SUITES=0 $ci_env ./.chug/tasks/ci.sh "$@") >"$OUT" 2>&1
	RC=$?
	set -e
}
stub_repo 0
ci_with CHUG_CI_QUIET=1
refute "a quiet run does not print a clean gate's output" 0 "$RC" "stub check-figures"
check "a quiet run names each clean gate" 0 "$RC" "ci: clean — check-figures"
check "a quiet run says where the logs are" 0 "$RC" "logged under"
check "a clean gate's output is in its log" 0 \
	"$(grep -q 'stub check-figures' "$(git -C "$R" rev-parse --absolute-git-dir)/chug-ci/check-figures.log"; echo $?)" ""

stub_failing check-paths 1
ci_with CHUG_CI_QUIET=1
check "a red gate shows the end of its log" 1 "$RC" "ci: | stub check-paths"
check "the gates after a red one still run" 1 "$RC" "ci: clean — check-shell-quoting"
check "a quiet run ends on its red gates" 1 "$RC" "ci:   check-paths — "
ci_with
check "a run streams by default" 1 "$RC" "stub check-figures"

stub_repo 0
printf '#!/bin/sh\necho first failure\nexit 1\n' > "$R/.chug/tasks/aa.test.sh"
git -C "$R" add -A
ci_with CHUG_CI_SHELL_SUITES=1
check "a red suite shows the end of its log" 1 "$RC" "ci: | first failure"

# `--only` runs the gates it names and nothing else, through the same wrapping.
stub_repo 0
ci_with CHUG_CI_SHELL_SUITES=1 -- --only check-paths source-static
check "--only runs a gate it names" 0 "$RC" "stub check-paths"
check "--only runs every gate it names" 0 "$RC" "stub check-source"
check "--only skips the rest" 0 "$RC" "check-figures: SKIPPED (not named by --only)"
check "--only skips the shell suites" 0 "$RC" "shell suites: SKIPPED (not named by --only)"
ci_with -- --only check-nothing
check "--only refuses a gate that is not one" 2 "$RC" "--only names check-nothing, which is no gate here"
ci_with -- --only
check "--only naming nothing could not run" 2 "$RC" "--only names no gate"
ci_with -- --everything
check "an argument that is not --only could not run" 2 "$RC" "takes no arguments but --only"
run_recorded TRACK_RECORD_TOKEN=t
grep -F 'run|--name|check-paths|' "$TRLOG" > "$WORK/.full-key"
: > "$TRLOG"
set +e
(cd "$R" && env PATH="$TRBIN:$PATH" STUB_TR_LOG="$TRLOG" TRACK_RECORD_TOKEN=t CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh --only check-paths) >/dev/null 2>&1
RC=$?
set -e
recorded_log
check "--only wraps the gate it names" 0 "$RC" "run|--name|check-paths|"
refute "--only wraps no other gate" 0 "$RC" "run|--name|check-figures|"
check "--only keys its gate as a full run does" 0 \
	"$(grep -F 'run|--name|check-paths|' "$TRLOG" | cmp -s - "$WORK/.full-key"; echo $?)" ""

stub_repo 0
ci_with -- --only check-paths source-static
check "an --only run ends on the gates it ran" 0 "$RC" \
	"ci: only the gates named ran, and each was clean: check-paths source-static"
refute "an --only run does not say all gates were clean" 0 "$RC" "all gates clean"

# A red gate in a quiet run shows as many lines of its log as CHUG_CI_TAIL_LINES.
stub_repo 0
printf '#!/bin/sh\nprintf "line %%s\\n" 1 2 3 4 5\nexit 1\n' > "$R/.chug/tasks/check-paths.sh"
git -C "$R" add -A
ci_with CHUG_CI_QUIET=1 CHUG_CI_TAIL_LINES=2
check "a quiet run shows the last line of a red gate's log" 1 "$RC" "ci: | line 5"
check "a quiet run shows CHUG_CI_TAIL_LINES lines of it" 2 "$(grep -c '^ci: | ' "$OUT")" ""

# ONE RUN HOLDS A CHECKOUT. A live holder refuses a second run; a dead one's
# lock is taken over, by one run of two that find it; a lock whose holder
# cannot be read is left alone.
stub_repo 0
lock="$(git -C "$R" rev-parse --absolute-git-dir)/chug-ci.lock"
sleep 30 &
holder=$!
ln -s "$holder" "$lock"
ci_with
check "a second run while one is alive could not run" 2 "$RC" "another ci.sh (pid $holder) is running"
check "a second run names where the first logs" 2 "$RC" "logging to $(dirname "$lock")/chug-ci;"
kill "$holder" 2>/dev/null || true
wait "$holder" 2>/dev/null || true
ci_with
check "a dead holder's lock is taken over" 0 "$RC" "all gates clean"
check "a run releases its lock" 0 "$([ ! -e "$lock" ] && [ ! -L "$lock" ]; echo $?)" ""

mkdir "$lock"
ci_with
check "a lock whose holder is not yet readable could not run" 2 "$RC" "names no holder that can be read"
check "a lock whose holder is not yet readable is not taken over" 0 "$([ -d "$lock" ]; echo $?)" ""
rmdir "$lock"

# The first run to claim a dead holder's lock stops, in a stub of the `rm` that
# removes the lock, until the case releases it; a second run starts meanwhile.
sleep 30 &
holder=$!
kill "$holder"
wait "$holder" 2>/dev/null || true
ln -s "$holder" "$lock"
mkdir -p "$WORK/rmbin"
cat > "$WORK/rmbin/rm" <<STUB
#!/bin/sh
if [ "\$*" = "-f $lock" ] && [ ! -e "$WORK/rm-paused" ]; then
	: > "$WORK/rm-paused"
	waited=0
	while [ ! -e "$WORK/rm-released" ] && [ "\$waited" -lt 120 ]; do
		sleep 1
		waited=\$((waited + 1))
	done
fi
exec $(command -v rm) "\$@"
STUB
chmod +x "$WORK/rmbin/rm"
OUT="$WORK/.first"
(cd "$R" && env PATH="$WORK/rmbin:$PATH" CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1 &
first=$!
waited=0
while [ ! -e "$WORK/rm-paused" ] && [ "$waited" -lt 120 ]; do
	sleep 1
	waited=$((waited + 1))
done
ci_with
check "of two runs taking over a dead holder's lock, the second could not run" 2 "$RC" \
	"another ci.sh is taking over $lock from pid $holder"
: > "$WORK/rm-released"
set +e
wait "$first"
RC=$?
set -e
OUT="$WORK/.first"
check "of two runs taking over a dead holder's lock, the first runs" 0 "$RC" "all gates clean"
check "a takeover leaves no lock and no claim" 0 \
	"$([ ! -L "$lock" ] && [ ! -L "$lock.$holder" ]; echo $?)" ""

# THE SERVER GATES' CODE IS WHAT THEIR SUITES IMPORT. The fixture is a small
# tree of modules, cruised by the tree's own dependency-cruiser under its own
# settings through a depcruise that counts its runs, that fails under
# STUB_DEPCRUISE=fail, prints what no reader can parse under =garbage, and
# loses every edge or every entry under =edges or =entries. Each entry a graph
# declaration names is a module in it, and each module imports or is imported,
# as the boundaries' rules require.
GRAPH_CALLS="$WORK/depcruise.calls"
cat > "$WORK/depcruise-mangle.js" <<'MANGLE'
const fs = require("node:fs");
const [mode, file] = process.argv.slice(2);
const cruised = JSON.parse(fs.readFileSync(file, "utf8"));
const entry = (path) =>
  /\.test\.ts$|^src\/roots\/migrate\.ts$/u.test(path);
if (mode === "edges") for (const each of cruised.modules) each.dependencies = [];
if (mode === "entries") {
  cruised.modules = cruised.modules.filter((each) => !entry(each.source));
  for (const each of cruised.modules)
    each.dependencies = each.dependencies.filter((dependency) => !entry(dependency.resolved));
}
process.stdout.write(JSON.stringify(cruised));
MANGLE
graph_module() { # <path> <line>...
	mkdir -p "$R/$(dirname "$1")"
	graph_path="$1"
	shift
	printf '%s\n' "$@" > "$R/$graph_path"
}
graph_repo() {
	stub_repo 0
	cp "$ROOT/.dependency-cruiser.cjs" "$ROOT/tsconfig.json" "$R/"
	mkdir -p "$R/node_modules/.bin"
	cat > "$R/node_modules/.bin/depcruise" <<STUB
#!/bin/sh
echo ran >> "$GRAPH_CALLS"
case "\${STUB_DEPCRUISE:-}" in
fail) exit 1 ;;
garbage) echo 'not a graph'; exit 0 ;;
esac
"$ROOT/node_modules/.bin/depcruise" "\$@" > "$WORK/depcruise.out" || exit
if [ -n "\${STUB_DEPCRUISE:-}" ]; then
	node "$WORK/depcruise-mangle.js" "\$STUB_DEPCRUISE" "$WORK/depcruise.out"
else
	cat "$WORK/depcruise.out"
fi
STUB
	chmod +x "$R/node_modules/.bin/depcruise"
	printf 'node_modules\n' > "$R/.gitignore"
	printf '{"name": "fixture"}\n' > "$R/package.json"
	printf 'export default [];\n' > "$R/eslint.config.js"
	printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/check-random.test.sh"
	for helper in _postgres.sh _keto.sh _test-timeout.sh; do
		printf '# helper\n' > "$R/.chug/tasks/$helper"
	done
	mkdir -p "$R/.chug/tasks/keto" "$R/deploy/rig" "$R/test/fixtures/fluxDeliveries" "$R/ui/chuggy-ui/app"
	printf 'version: v0\n' > "$R/.chug/tasks/keto/keto.yml"
	printf -- '-- wipe\n' > "$R/deploy/rig/wipe-tickets.sql"
	printf 'HTTP/1.1 200 OK\n' > "$R/test/fixtures/fluxDeliveries/push.http"
	mkdir -p "$R/src/roots"
	printf '[]\n' > "$R/src/roots/runnerReleases.json"
	printf '{}\n' > "$R/test/interpreter.json"
	printf 'export const shown = 1;\n' > "$R/ui/chuggy-ui/app/shown.ts"
	graph_module src/contract/configurationDocument.ts 'export const document = 1;'
	graph_module src/kinds.ts 'export type Kind = "a";'
	graph_module src/shape.ts 'export type Shape = { readonly side: number };'
	graph_module src/shapes.ts 'export type { Shape } from "./shape.ts";'
	graph_module src/domain/deciders.ts 'export const decide = 1;'
	graph_module src/adapters/postgres/pool.ts \
		'import { document } from "../../contract/configurationDocument.ts";' 'export const pool = document;'
	for root in migrate provisionAgentSession provisionProjectAccess nativeHttp controlPlane \
		provisionAccessDefaults; do
		graph_module "src/roots/$root.ts" \
			'import { document } from "../contract/configurationDocument.ts";' "export const $root = document;"
	done
	graph_module .chug/tasks/postgres-databases.ts \
		'import { pool } from "../../src/adapters/postgres/pool.ts";' 'export const databases = pool;'
	graph_module test/postgres/harness.ts 'export const harness = 1;'
	graph_module test/postgres/schedulerRootPorts.ts \
		'import { harness } from "./harness.ts";' 'export const ports = harness;'
	graph_module test/postgres/store.test.ts \
		'import { pool } from "../../src/adapters/postgres/pool.ts";' \
		'import type { Kind } from "../../src/kinds.ts";' \
		'import { ports } from "./schedulerRootPorts.ts";' \
		'export const kind: Kind = "a";' 'export const stored = pool + ports;'
	graph_module test/keto/access.test.ts \
		'import { document } from "../../src/contract/configurationDocument.ts";' \
		'import type { Shape } from "../../src/shapes.ts";' \
		'export const square: Shape = { side: document };'
	graph_module test/random/walk.test.ts \
		'import { decide } from "../../src/domain/deciders.ts";' 'export const walked = decide;'
	graph_module test/conformance/replay.test.ts \
		'import { decide } from "../../src/domain/deciders.ts";' 'export const replayed = decide;'
	graph_module test/interpreter/taskBriefing.test.ts \
		'import { decide } from "../../src/domain/deciders.ts";' 'export const briefed = decide;'
	commit_all baseline
	: > "$GRAPH_CALLS"
}
# The last commit as the change, through the suite stage too.
graph_run() { # [VAR=value...]
	OUT="$WORK/.out"
	set +e
	(cd "$R" && env CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=1 "$@" ./.chug/tasks/ci.sh) >"$OUT" 2>&1
	RC=$?
	set -e
}
# Each gate and suite that reads the graph, checked as selected or skipped:
# the ones given ran, and the rest were skipped.
graph_selected() { # <label> [<gate id or suite>...]
	graph_label="$1"
	shift
	for graph_reader in check-postgres check-queries check-keto check-random.test.sh; do
		graph_named=0
		for graph_given do [ "$graph_given" != "$graph_reader" ] || graph_named=1; done
		if [ "$graph_reader" = check-random.test.sh ]; then
			graph_ran="  - .chug/tasks/check-random.test.sh"
			if [ "$graph_named" = 1 ]; then
				check "$graph_label selects $graph_reader" 0 "$RC" "$graph_ran"
			else
				refute "$graph_label leaves out $graph_reader" 0 "$RC" "$graph_ran"
			fi
		elif [ "$graph_named" = 1 ]; then
			check "$graph_label selects $graph_reader" 0 "$RC" "stub $graph_reader"
		else
			check "$graph_label leaves out $graph_reader" 0 "$RC" "$graph_reader: SKIPPED"
		fi
	done
}
# A change, committed, and which readers of the graph it must select.
graph_change() { # <label> <gate id or suite>... — the change already made in $R
	graph_change_label="$1"
	shift
	commit_all "$graph_change_label"
	graph_run
	graph_selected "$graph_change_label" "$@"
}

graph_repo
printf 'export const briefed2 = 2;\n' >> "$R/test/interpreter/taskBriefing.test.ts"
graph_change "a test outside every server suite's graph"
printf 'export const shown2 = 2;\n' >> "$R/ui/chuggy-ui/app/shown.ts"
graph_change "a module under the console"
printf 'export const document2 = 2;\n' >> "$R/src/contract/configurationDocument.ts"
graph_change "a source every server suite reaches" check-postgres check-queries check-keto
printf 'export const harness2 = 2;\n' >> "$R/test/postgres/harness.ts"
graph_change "a helper under the database suites" check-postgres
printf 'export type Other = "b";\n' >> "$R/src/kinds.ts"
graph_change "a module reached only through an import of a type" check-postgres
printf 'export type Side = number;\n' >> "$R/src/shape.ts"
graph_change "a module reached only through a re-export of a type" check-keto
printf 'export const decide2 = 2;\n' >> "$R/src/domain/deciders.ts"
graph_change "a decider the walk imports" check-random.test.sh
printf '{"changed": 1}\n' > "$R/test/interpreter.json"
graph_change "a file under the tests that is no module" check-postgres check-queries check-keto \
	check-random.test.sh
printf '{}\n' > "$R/test/interpreter/brief.json"
graph_change "a new file under the tests that no import names" check-postgres check-queries check-keto \
	check-random.test.sh
git -C "$R" rm -q test/interpreter/brief.json
graph_change "a file deleted from the tests" check-postgres check-queries check-keto check-random.test.sh
git -C "$R" rm -q test/interpreter/taskBriefing.test.ts
graph_change "a module deleted from the tests" check-postgres check-queries check-keto check-random.test.sh
printf '# notes\n' > "$R/test/postgres/NOTES.md"
graph_change "a page among the database suites"
OUT="$GRAPH_CALLS"
printf 'calls %s\n' "$(grep -c . "$GRAPH_CALLS")" >> "$GRAPH_CALLS"
check "depcruise ran once a run, and not for a page" 0 0 "calls 11"

# A file that declares into every scope selects the typed tool wherever it is,
# when it starts to, when it stops, and as a declaration file of any name; no
# server suite reads it.
graph_repo
graph_module test/interpreter/ambient.ts 'export const ambient = 1;' \
	'import "./taskBriefing.test.ts";'
commit_all ambient-baseline
printf 'declare global {\n  interface Ambient { readonly seen: true }\n}\n' >> "$R/test/interpreter/ambient.ts"
graph_change "a test that starts declaring into every scope" check-queries
graph_module test/interpreter/ambient.ts 'export const ambient = 1;' 'import "./taskBriefing.test.ts";'
graph_change "a test that stops declaring into every scope" check-queries
printf 'declare module "shown" {}\n' > "$R/ui/chuggy-ui/app/shown.d.ts"
graph_change "a declaration file under the console" check-queries

# What each declaration names by hand selects its gate: the files its suites
# and scripts read by a path, and the processes they run by one.
graph_repo
for case in \
	"deploy/rig/wipe-tickets.sql|check-postgres" "test/fixtures/fluxDeliveries/push.http|check-postgres" \
	"src/roots/runnerReleases.json|check-postgres" ".chug/tasks/keto/keto.yml|check-keto" \
	".chug/tasks/_postgres.sh|check-postgres|check-queries|check-keto" ".chug/tasks/_keto.sh|check-keto" \
	".chug/tasks/_test-timeout.sh|check-postgres|check-keto" \
	".chug/tasks/postgres-databases.ts|check-postgres|check-queries|check-keto" \
	"package.json|check-postgres|check-queries|check-keto" "tsconfig.json|check-queries" \
	"eslint.config.js|check-queries" ".dependency-cruiser.cjs|check-postgres|check-keto" \
	"src/roots/migrate.ts|check-postgres|check-queries" "src/roots/nativeHttp.ts|check-postgres" \
	"src/roots/controlPlane.ts|check-postgres" "src/roots/provisionAgentSession.ts|check-postgres|check-keto" \
	"src/roots/provisionProjectAccess.ts|check-postgres|check-keto" \
	"src/roots/provisionAccessDefaults.ts|check-keto" "test/postgres/schedulerRootPorts.ts|check-postgres" \
	".chug/tasks/check-postgres.sh|check-postgres" ".chug/tasks/check-queries.sh|check-queries" \
	".chug/tasks/check-keto.sh|check-keto" ".chug/tasks/check-conformance.sh|check-random.test.sh"; do
	path="${case%%|*}"
	case "$path" in
	*.ts) printf 'export const changed = 1;\n' >> "$R/$path" ;;
	*.json) printf '{"changed": 1}\n' > "$R/$path" ;;
	*.js | *.cjs) printf '\n' >> "$R/$path" ;;
	*) printf '# changed\n' >> "$R/$path" ;;
	esac
	commit_all "$path"
	graph_run
	gates="${case#*|}|"
	while [ -n "$gates" ]; do
		gate="${gates%%|*}"
		if [ "$gate" = check-random.test.sh ]; then
			check "$path selects $gate" 0 "$RC" "  - .chug/tasks/$gate"
		else
			check "$path selects $gate" 0 "$RC" "stub $gate"
		fi
		gates="${gates#*|}"
	done
done

# A GRAPH THAT CANNOT BE COMPUTED OR BELIEVED SELECTS: each reader of it runs
# on a change to a module under the console, which no graph of theirs reaches.
for case in "no depcruise|STUB_DEPCRUISE=" "a depcruise that fails|STUB_DEPCRUISE=fail" \
	"output that is no graph|STUB_DEPCRUISE=garbage" "a graph with no edges|STUB_DEPCRUISE=edges" \
	"a graph without its entries|STUB_DEPCRUISE=entries"; do
	label="${case%%|*}"
	graph_repo
	[ "$label" != "no depcruise" ] || rm "$R/node_modules/.bin/depcruise"
	printf 'export const shown2 = 2;\n' >> "$R/ui/chuggy-ui/app/shown.ts"
	commit_all console
	graph_run "${case#*|}"
	graph_selected "$label" check-postgres check-queries check-keto check-random.test.sh
done
# A package that does not resolve is an install behind the lock, and an
# import of it anywhere leaves no graph believed.
graph_repo
graph_module test/interpreter/taskBriefing.test.ts \
	'import { decide } from "../../src/domain/deciders.ts";' 'import { z } from "zod";' \
	'export const briefed = decide + String(z);'
graph_change "a package that does not resolve" check-postgres check-queries check-keto \
	check-random.test.sh

# The keys read the graph the selection does, built once for both, and hold
# what the suites reach, a type-only import's included, and not the tests
# beside them; a graph that cannot be computed keys on the whole tree.
graph_repo
printf 'export const document2 = 2;\n' >> "$R/src/contract/configurationDocument.ts"
printf 'export const walked2 = 2;\n' >> "$R/test/random/walk.test.ts"
commit_all several
: > "$TRLOG"
graph_run PATH="$TRBIN:$PATH" STUB_TR_LOG="$TRLOG" TRACK_RECORD_TOKEN=t
graph_selected "a change several graphs reach" check-postgres check-queries check-keto check-random.test.sh
OUT="$GRAPH_CALLS"
printf 'calls %s\n' "$(grep -c . "$GRAPH_CALLS")" >> "$GRAPH_CALLS"
check "depcruise ran once for every selection and key of a run" 0 0 "calls 1"
grep "^run|--name|check-postgres|" "$TRLOG" > "$WORK/.line" || true
OUT="$WORK/.line"
check "the database's key holds a suite" 0 0 "|--inputs|test/postgres/store.test.ts|"
check "the database's key holds a module its suites import a type from" 0 0 "|--inputs|src/kinds.ts|"
check "the database's key holds a file under the tests that is no module" 0 0 \
	"|--inputs|test/interpreter.json|"
check "the database's key holds what its scripts read by a path" 0 0 "|--inputs|deploy/rig/wipe-tickets.sql|"
refute "the database's key leaves out a test its suites do not import" 0 0 \
	"test/interpreter/taskBriefing.test.ts"
refute "the database's key leaves out the sources its suites do not import" 0 0 "src/domain/deciders.ts"
refute "the database's key names no directory it once held whole" 0 0 "|--inputs|test|"
check "the database's key scopes the ignored files to the directories it held whole" 0 0 \
	"$record_tool_ignored "
check "the database's key scopes the ignored files under the tests" 0 0 "'test'|"
grep "^run|--name|check-queries|" "$TRLOG" > "$WORK/.line" || true
check "the query check's key holds what its lint reaches" 0 0 "|--inputs|src/adapters/postgres/pool.ts|"
refute "the query check's key leaves out the suites" 0 0 "test/postgres/store.test.ts"
grep "^run|--name|.chug/tasks/check-random.test.sh|" "$TRLOG" > "$WORK/.line" || true
check "the random replay's key holds what its walk imports" 0 0 "|--inputs|src/domain/deciders.ts|"
refute "the random replay's key leaves out the database's suites" 0 0 "test/postgres/store.test.ts"
graph_repo
printf 'export const shown2 = 2;\n' >> "$R/ui/chuggy-ui/app/shown.ts"
commit_all console
: > "$TRLOG"
graph_run PATH="$TRBIN:$PATH" STUB_TR_LOG="$TRLOG" TRACK_RECORD_TOKEN=t STUB_DEPCRUISE=fail
grep "^run|--name|check-postgres|" "$TRLOG" > "$WORK/.line" || true
OUT="$WORK/.line"
check "a graph that cannot be computed keys the database on the whole tree" 0 0 \
	"run|--name|check-postgres|--tool|$record_tool_node|--tool|$record_tool_install|--tool|$record_tool_ignored|--salt|$salt|"

# What no reader of the graph reads leaves it out: the model, which only the
# random replay's own gate reads, an action's document and the roles file.
graph_repo
mkdir -p "$R/model" "$R/.chug/actions" "$R/deploy/rig/postgres"
printf 'module m {}\n' > "$R/model/domain.qnt"
printf '{"before": 1}\n' > "$R/.chug/actions/build.json"
printf -- '-- roles\n' > "$R/deploy/rig/postgres/postgres-roles.sql"
commit_all unread-baseline
printf 'module m { val changed = 1 }\n' > "$R/model/domain.qnt"
graph_change "a model change" check-random.test.sh
printf '{"after": 1}\n' > "$R/.chug/actions/build.json"
graph_change "an action's document"
printf -- '-- roles, changed\n' > "$R/deploy/rig/postgres/postgres-roles.sql"
graph_change "the roles file"

# Each key holds exactly what the graph and the declaration name: what it holds
# of the install, its inputs as the scope of its ignored files with the
# directories it no longer holds whole beside them, the places its tools look,
# and its inputs, the graph's own settings and what the entries reach first.
graph_pin() { # <id> <held> <inputs> <directories> <places> — each list a path a word
	set -f
	graph_specs=""
	graph_inputs=""
	for graph_word in $3; do
		graph_specs="$graph_specs '$graph_word'"
		graph_inputs="$graph_inputs--inputs|$graph_word|"
	done
	for graph_word in $4; do graph_specs="$graph_specs '$graph_word'"; done
	graph_places=""
	for graph_word in $5; do graph_places="$graph_places '$graph_word'"; done
	set +f
	[ -z "$graph_places" ] || graph_places="--tool|$record_tool_probed$graph_places|"
	grep "^run|--name|$1|" "$TRLOG" > "$WORK/.line" || true
	OUT="$WORK/.line"
	check "$1 holds exactly what its graph and its declaration name" 0 0 \
		"run|--name|$1|--tool|$record_tool_node|--tool|$2|--tool|$record_tool_ignored$graph_specs|$graph_places$graph_inputs--salt|$salt|"
}
graph_repo
: > "$TRLOG"
graph_run PATH="$TRBIN:$PATH" STUB_TR_LOG="$TRLOG" TRACK_RECORD_TOKEN=t CHUG_CI_BASE=no-such-base
graph_own=".chug/tasks/_import-graph.sh .dependency-cruiser.cjs tsconfig.json"
graph_unheld="src/roots/runnerReleases.json test/fixtures/fluxDeliveries/push.http test/interpreter.json"
graph_server_looks=".chug/tasks/node_modules .chug/tasks/package.json .chug/node_modules .chug/package.json"
graph_pin check-postgres "$record_tool_install" "$graph_own .chug/tasks/postgres-databases.ts \
	src/adapters/postgres/pool.ts src/contract/configurationDocument.ts src/kinds.ts \
	src/roots/controlPlane.ts src/roots/migrate.ts src/roots/nativeHttp.ts \
	src/roots/provisionAgentSession.ts src/roots/provisionProjectAccess.ts $graph_unheld \
	test/postgres/harness.ts test/postgres/schedulerRootPorts.ts test/postgres/store.test.ts \
	deploy/rig/wipe-tickets.sql src/roots/runnerReleases.json test/fixtures/fluxDeliveries package.json \
	.chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts .chug/tasks/check-postgres.sh \
	.chug/tasks/_test-timeout.sh" "src test" "$graph_server_looks"
graph_pin check-queries "$record_tool_install" "$graph_own .chug/tasks/postgres-databases.ts \
	src/adapters/postgres/pool.ts src/contract/configurationDocument.ts src/roots/migrate.ts \
	$graph_unheld package.json tsconfig.json eslint.config.js .chug/tasks/_postgres.sh \
	.chug/tasks/postgres-databases.ts .chug/tasks/check-queries.sh" "src test scripts" \
	":(glob)eslint.config.* .eslintignore .eslintcache eslint-suppressions.json $graph_server_looks"
graph_pin check-keto "$record_tool_install" "$graph_own .chug/tasks/postgres-databases.ts \
	src/adapters/postgres/pool.ts src/contract/configurationDocument.ts \
	src/roots/provisionAccessDefaults.ts src/roots/provisionAgentSession.ts \
	src/roots/provisionProjectAccess.ts src/roots/runnerReleases.json src/shape.ts src/shapes.ts \
	test/fixtures/fluxDeliveries/push.http test/interpreter.json test/keto/access.test.ts \
	.chug/tasks/keto package.json .chug/tasks/_keto.sh .chug/tasks/_postgres.sh \
	.chug/tasks/postgres-databases.ts .chug/tasks/check-keto.sh .chug/tasks/_test-timeout.sh" \
	"src test" "$graph_server_looks"
graph_pin .chug/tasks/check-random.test.sh \
	"$record_tool_installed 'dependency-cruiser' 'zod' '@kasofsk/chug-ticket-domain'" \
	".chug/tasks/check-random.test.sh .chug/tasks/_suite.sh .chug/tasks/check-conformance.sh $graph_own \
	src/domain/deciders.ts src/roots/runnerReleases.json test/conformance/replay.test.ts \
	test/fixtures/fluxDeliveries/push.http test/interpreter.json test/random/walk.test.ts \
	src/domain src/generated test/random test/conformance test/domain test/itf model \
	.chug/tasks/check-random.sh :(glob)**/package.json" "src test" "src/node_modules src/package.json"

# A KEY ON THE GRAPH IS REUSED ACROSS TREES THAT DIFFER ONLY OUTSIDE IT. Against
# the stub's store, every gate selected by a base that does not resolve, a
# change no suite of the database imports reuses its pass, and one it imports,
# by a type alone, runs it again.
graph_repo
lock_json 0.32.0 1.0.0 4.0.0 1.0.0 > "$R/node_modules/.package-lock.json"
rm -rf "$WORK/graph-store"
mkdir -p "$WORK/graph-store"
graph_stored() { # <label> <ran or reused> <gate>
	commit_any "$1"
	graph_run PATH="$TRBIN:$PATH" STUB_TR_LOG="$TRLOG" TRACK_RECORD_TOKEN=t \
		STUB_TR_STORE="$WORK/graph-store" CHUG_CI_BASE=no-such-base
	sed -n 's/^stub \([a-z-]*\)$/ran \1|/p; s/^track-record: REUSED \([^ ]*\) .*/reused \1|/p' \
		"$OUT" > "$WORK/.stored"
	OUT="$WORK/.stored"
	check "$1 leaves $3 $2" 0 "$RC" "$2 $3|"
}
graph_stored "a first run" ran check-postgres
graph_stored "the same tree again" reused check-postgres
printf 'export const shown2 = 2;\n' >> "$R/ui/chuggy-ui/app/shown.ts"
graph_stored "a console change" reused check-postgres
printf 'export const briefed2 = 2;\n' >> "$R/test/interpreter/taskBriefing.test.ts"
graph_stored "a test no database suite imports" reused check-postgres
printf 'export type Other = "b";\n' >> "$R/src/kinds.ts"
graph_stored "a module a database suite imports a type from" ran check-postgres
graph_stored "the tree that moved, again" reused check-postgres

# THE UNIT STAGE SELECTS AND KEYS EACH CLOSED SUITE ON ITS OWN. The fixture is
# the graph's, with the tree's own runner gate for the unit suites, and its
# listing, cap and reporter, and
# a unit suite of each kind: closed ones reaching a decider, a module only for
# a type and a module under the console; open ones importing fs themselves and
# through a module; and beside them the suites other gates own.
unit_open="test/unit/reads.test.ts test/unit/relayed.test.ts"
unit_closed="test/interpreter/taskBriefing.test.ts test/unit/shown.test.ts test/unit/typed.test.ts"
unit_repo() {
	graph_repo
	cp "$ROOT/.chug/tasks/check-source.sh" "$R/.chug/tasks/check-source-unit.sh"
	cp "$ROOT/.chug/tasks/_test-timeout.sh" "$R/.chug/tasks/"
	printf '#!/bin/sh
[ "$1" != --static ] || { echo stub check-source; exit 0; }
exec sh "$(dirname "$0")/check-source-unit.sh" "$@"
' \
		> "$R/.chug/tasks/check-source.sh"
	mkdir -p "$R/scripts" "$R/images/worker" "$R/.chug/configurations"
	cp "$ROOT/scripts/unit-outcomes.ts" "$R/scripts/"
	graph_module test/unit/typed.test.ts 'import type { Kind } from "../../src/kinds.ts";' \
		'export const kind: Kind = "a";'
	graph_module test/unit/shown.test.ts 'import { shown } from "../../ui/chuggy-ui/app/shown.ts";' \
		'export const seen = shown;'
	graph_module test/unit/reads.test.ts 'import { readFileSync } from "node:fs";' \
		'export const read = readFileSync;'
	graph_module test/unit/reader.ts 'import { readFileSync } from "node:fs";' \
		'export const reader = readFileSync;'
	graph_module test/unit/relayed.test.ts 'import { reader } from "./reader.ts";' \
		'export const relayed = reader;'
	graph_module ui/chuggy-ui/app/shown.test.ts 'import { shown } from "./shown.ts";' \
		'export const own = shown;'
	printf 'FROM node:0 AS base\n' > "$R/images/worker/Dockerfile"
	printf '{}\n' > "$R/.chug/configurations/x.json"
	printf '{}\n' > "$R/package-lock.json"
	commit_all unit-baseline
}
# The suites the last run ran, exactly, and its unit stage's account of itself.
unit_ran() { # <label> <suite>...
	unit_label="$1"
	shift
	unit_want="$(printf '%s\n' "$@" | sed '/^$/d' | sort | tr '\n' ' ')"
	unit_got="$(cd "$R/.git/chug-ci/unit/results" 2>/dev/null &&
		find . -name '*.outcome' | sed 's|^\./||; s|\.outcome$||' | sort | tr '\n' ' ')" || true
	printf 'unit ran: %s|\n' "$unit_got" >> "$OUT"
	check "$unit_label runs exactly ${*:-no unit suite}" "${unit_rc:-0}" "$RC" "unit ran: $unit_want|"
}
# A change, committed, and the suites it must run.
unit_change() { # <label> <suite>...
	commit_all "$1"
	graph_run
	unit_ran "$@"
}

unit_repo
graph_run CHUG_CI_BASE=no-such-base
# shellcheck disable=SC2086 # a path a word, by construction
unit_ran "a full run" $unit_open $unit_closed
check "a full run's stage counts what it found and ran" 0 "$RC" \
	"ci: unit suites 3 closed, 2 open; 5 selected, 0 reused, 5 ran"
OUT="$WORK/.out"
set +e
(cd "$R" && ./.chug/tasks/check-source.sh --unit) >"$OUT" 2>&1
RC=$?
set -e
check "the runner's own gate runs the same suites, given none" 0 "$RC" "unit ran 5 suite(s); 5 left to"

# shellcheck disable=SC2086 # a path a word, by construction
{
	graph_module test/deep/nested/added.test.ts 'import { decide } from "../../../src/domain/deciders.ts";' \
		'export const added = decide;'
	unit_change "a suite added deep under the tests" test/deep/nested/added.test.ts $unit_open
	printf 'export const kind2 = 2;\n' >> "$R/test/unit/typed.test.ts"
	unit_change "an edit to a closed suite's own file" test/unit/typed.test.ts $unit_open
	printf 'export type Other = "b";\n' >> "$R/src/kinds.ts"
	unit_change "an edit to a module a suite imports a type from" test/unit/typed.test.ts $unit_open
	printf 'export const decide2 = 2;\n' >> "$R/src/domain/deciders.ts"
	unit_change "an edit to a module two suites import" test/interpreter/taskBriefing.test.ts \
		test/deep/nested/added.test.ts $unit_open
	printf 'export const shown2 = 2;\n' >> "$R/ui/chuggy-ui/app/shown.ts"
	unit_change "an edit under the console" test/unit/shown.test.ts $unit_open
	printf '# changed\n' >> "$R/images/worker/Dockerfile"
	unit_change "an edit to the worker image" $unit_open
	printf '{"changed": 1}\n' > "$R/.chug/configurations/x.json"
	unit_change "an edit to a declared configuration" $unit_open
	printf '# notes\n' > "$R/test/unit/NOTES.md"
	unit_change "a page among the suites"
	printf '{"compilerOptions": {}}\n' > "$R/tsconfig.json"
	unit_change "an edit to the compiler's settings" test/deep/nested/added.test.ts $unit_open $unit_closed
	printf '{"changed": 1}\n' > "$R/package-lock.json"
	unit_change "an edit to the lock" test/deep/nested/added.test.ts $unit_open $unit_closed
	printf '# changed\n' >> "$R/.chug/tasks/_test-timeout.sh"
	unit_change "an edit to the cap every suite runs under" test/deep/nested/added.test.ts \
		$unit_open $unit_closed
}

# A suite that gains a read of the filesystem, or a module loaded by a name
# that is not a literal, or an import that resolves to nothing, is open in the
# change that brings it, directly or through a module it reaches.
for case in \
	"an import of fs in the suite|test/unit/typed.test.ts|import { readFileSync } from \"node:fs\"; export const r = readFileSync;" \
	"an import of fs in a module it reaches|src/kinds.ts|import { readFileSync } from \"node:fs\"; export const r = readFileSync;" \
	"a module loaded by a name that is not a literal|src/kinds.ts|const name = \"./shape.ts\"; export const loaded = await import(name);" \
	"a platform module taken without an import|src/kinds.ts|export const got = process.getBuiltinModule(\"node:fs\");"; do
	label="${case%%|*}"
	rest="${case#*|}"
	unit_repo
	printf '%s\n' "${rest#*|}" >> "$R/${rest%%|*}"
	commit_all "$label"
	graph_run
	check "$label opens the suite" 0 "$RC" "ci: unit suites 2 closed, 3 open;"
	# shellcheck disable=SC2086 # a path a word, by construction
	unit_ran "$label" $unit_open test/unit/typed.test.ts
done
unit_repo
graph_module test/unit/shown.test.ts 'import { missing } from "./missing.ts";' 'export const seen = missing;'
commit_all unresolved
graph_run
check "an import that resolves to nothing opens the suite that reaches it" 1 "$RC" \
	"ci: unit suites 2 closed, 3 open;"

# A graph that cannot be computed or believed selects every suite, as open.
for case in "a depcruise that fails|STUB_DEPCRUISE=fail" "a graph with no edges|STUB_DEPCRUISE=edges"; do
	label="${case%%|*}"
	unit_repo
	printf '# changed\n' >> "$R/images/worker/Dockerfile"
	commit_all "$label"
	graph_run "${case#*|}"
	check "$label leaves every suite open" 0 "$RC" "ci: unit suites 0 closed, 5 open;"
	# shellcheck disable=SC2086 # a path a word, by construction
	unit_ran "$label" $unit_open $unit_closed
done
unit_repo
graph_module test/unit/typed.test.ts 'import { z } from "zod";' 'export const kind = String(z);'
commit_all unbelieved
graph_run
check "a package that does not resolve leaves every suite open" 1 "$RC" "ci: unit suites 0 closed, 5 open;"
check "and says why" 1 "$RC" "ci: every unit suite is open, as the import graph cannot be believed"

# A QUIET RUN NAMES THE RED SUITES AND NOTHING PER CLEAN ONE.
unit_repo
graph_module test/unit/typed.test.ts 'import { test } from "node:test";' \
	'test("this closed one is meant to fail", () => { throw new Error("red by design"); });'
commit_all red
graph_run CHUG_CI_QUIET=1
check "a red suite is named" 1 "$RC" "ci: FAILED — test/unit/typed.test.ts"
check "with the end of its log" 1 "$RC" "red by design"
check "and its stage is red" 1 "$RC" "ci: FAILED — check-source unit"
for suite in $unit_open; do
	refute "a quiet run prints nothing of the clean suite $suite" 1 "$RC" "$suite"
done
unit_rc=1
# shellcheck disable=SC2086 # a path a word, by construction
unit_ran "a red suite" test/unit/typed.test.ts $unit_open
unit_rc=""

# A CLOSED SUITE WHOSE INPUTS DID NOT CHANGE IS REUSED. Against the stub's
# store, every suite selected by a base that does not resolve, a second run of
# one tree reuses every entry, and a change to one closed suite's module runs
# that suite and the open ones, keyed on the whole tree, and reuses the rest.
unit_repo
lock_json 0.32.0 1.0.0 4.0.0 1.0.0 > "$R/node_modules/.package-lock.json"
rm -rf "$WORK/unit-store"
mkdir -p "$WORK/unit-store"
unit_stored() { # <label> <suite>...
	commit_any "$1"
	graph_run PATH="$TRBIN:$PATH" STUB_TR_LOG="$TRLOG" TRACK_RECORD_TOKEN=t \
		STUB_TR_STORE="$WORK/unit-store" CHUG_CI_BASE=no-such-base
	unit_ran "$@"
}
# shellcheck disable=SC2086 # a path a word, by construction
{
	unit_stored "a first run under a token" $unit_open $unit_closed
	unit_stored "the same tree again"
	check "which reuses every suite" 0 "$RC" "5 selected, 5 reused, 0 ran"
	# Every wrapped stub gate and every unit suite, each open one counted
	# though they are one entry.
	check "and counts each reused suite in the run's total" 0 "$RC" "ci: all gates clean (23 reused)"
	printf 'export type Other = "b";\n' >> "$R/src/kinds.ts"
	unit_stored "a module one closed suite reaches" test/unit/typed.test.ts $unit_open
	check "which reuses the other closed suites" 0 "$RC" "5 selected, 2 reused, 3 ran"
}
grep "^run|--name|source-unit:test/unit/typed.test.ts|" "$TRLOG" | tail -n 1 > "$WORK/.line" || true
OUT="$WORK/.line"
check "a closed suite's key holds what it reaches" 0 0 "|--inputs|src/kinds.ts|"
check "and what every suite runs under" 0 0 "|--inputs|.chug/tasks/check-source.sh|"
check "and the root's tools" 0 0 "|--inputs|package-lock.json|"
check "and the setup program" 0 0 "|--env|CHUG_SETUP_PROGRAM|"
check "and replays its own outcome" 0 0 "|--|./.chug/tasks/check-source.sh|--unit-outcome|test/unit/typed.test.ts|"
refute "and not a suite it does not reach" 0 0 "src/domain/deciders.ts"
grep "^run|--name|source-unit|" "$TRLOG" | tail -n 1 > "$WORK/.line" || true
check "the open suites are keyed together on the whole tree" 0 0 \
	"run|--name|source-unit|--tool|$record_tool_node|--tool|$record_tool_install|--tool|$record_tool_ignored|--salt|$salt|--env|CHUG_SETUP_PROGRAM|--|./.chug/tasks/check-source.sh|--unit-outcome|test/unit/reads.test.ts|test/unit/relayed.test.ts|"

done_ "ci.test.sh"
