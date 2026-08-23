#!/bin/sh
# Shell test for check-model.sh.
#
# Every case drives a STUB quint: what is under test is the gate's refusals —
# the paths where it must report could-not-run rather than pass — and those are
# exactly the paths a real run never exercises.
#
# Run:  .chug/tasks/check-model.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-model.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"

# A PATH holding only git, so `command -v quint` can be made to fail. Without
# it the real quint satisfies the fallback and the no-quint case cannot go red.
GITBIN="$WORK/gitonly"
mkdir -p "$GITBIN"
ln -sf "$(command -v git)" "$GITBIN/git"

# The stub answers per subcommand, because what the gate must tell apart is a
# stage that reached a verdict from one that could not, and those differ by
# what the call printed rather than by the status it exited with. Each case
# sets STUB_RC_<sub> and STUB_OUT_<sub> after building the repo; a `test` call
# reports one passing test by default, because a `quint test` that selects
# nothing prints no such line and the gate must tell the two apart.
#
# It colours its verdict line under FORCE_COLOR the way quint does, so what the
# gate reads is what a caller's environment would have made of it.
model_repo() { # <quint-version>
	rm -rf "$R"
	mkdir -p "$R/model/mc" "$R/model/tests" "$R/node_modules/.bin"
	git -C "$R" init -q -b main
	git -C "$R" config user.email t@example.com
	git -C "$R" config user.name t
	: > "$R/model/domain.qnt"
	: > "$R/model/mc/mc_chuggy.qnt"
	: > "$R/model/tests/chuggy_test.qnt"
	cat > "$R/node_modules/.bin/quint" <<STUB
#!/bin/sh
if [ "\$1" = "--version" ]; then echo "$1"; exit 0; fi
sub="\$1"
eval "out=\\\${STUB_OUT_\$sub-}"
eval "rc=\\\${STUB_RC_\$sub-0}"
if [ -n "\${FORCE_COLOR-}" ]; then out="\$(printf '\\033[32m')\$out"; fi
if [ -n "\$out" ]; then echo "\$out"; fi
exit "\$rc"
STUB
	chmod +x "$R/node_modules/.bin/quint"
	git -C "$R" add -A
	STUB_RC_typecheck=0 STUB_RC_test=0 STUB_RC_run=0
	STUB_OUT_typecheck='' STUB_OUT_test='  1 passing (1ms)' STUB_OUT_run=''
	export STUB_RC_typecheck STUB_RC_test STUB_RC_run
	export STUB_OUT_typecheck STUB_OUT_test STUB_OUT_run
}

run_in_repo() {
	OUT="$WORK/.out"
	set +e
	(cd "$R" && "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

# THE COVERAGE FIGURE. The gate calls `quint test` once per unit suite, witness
# module and refinement suite; the stub reports one passing test for each, so
# the total the success line prints is a fixture size this suite knows.
model_repo 0.32.0
run_in_repo
check "a clean model run exits 0" 0 "$RC" "0 failure(s), 14 test(s) run"

# A CALLER'S FORCE_COLOR MUST NOT REACH QUINT. Every verdict is read out of
# Quint's own text, so a colour escape in front of the passing count reads as a
# suite that selected nothing — a clean model reported as a wall of findings,
# out of an environment variable the gate never set. `NO_COLOR` does not answer
# it, because FORCE_COLOR beats NO_COLOR and the stub above behaves that way.
model_repo 0.32.0
FORCE_COLOR=1
export FORCE_COLOR
run_in_repo
unset FORCE_COLOR
check "a caller's FORCE_COLOR does not hide a suite that ran" 0 "$RC" "14 test(s) run"

# A SUITE THAT SELECTED NOTHING IS NOT A SUITE THAT PASSED. Quint runs only the
# names its match selects and exits 0 when that is none of them, so a renamed
# run would otherwise leave the gate reporting a clean unit suite over a file
# it never executed.
model_repo 0.32.0
STUB_OUT_test=""
run_in_repo
check "a suite selecting no tests is a finding" 1 "$RC" "selected no tests"

# A SUITE THAT RAN AND FAILED IS A FINDING, and what it said is kept: a witness
# that fails once and passes on the rerun leaves nothing to diagnose if the run
# that failed went to /dev/null.
model_repo 0.32.0
STUB_RC_test=1
STUB_OUT_test="  1 passing (1ms)
  1 failed — the witness said something worth reading"
run_in_repo
check "a suite that ran and failed is a finding" 1 "$RC" "failure(s)"
check "a failing suite prints what it said" 1 "$RC" "worth reading"

# A VIOLATED INVARIANT IS A FINDING, and its seed reaches the reader, because
# the whole value of a randomized refutation is reproducing it.
model_repo 0.32.0
STUB_RC_run=1
STUB_OUT_run="[violation] Found an issue
Use --seed=0x1c6f70db7e06ad9b to reproduce."
run_in_repo
check "a refuted invariant is a finding" 1 "$RC" "violated an invariant"
check "a refuted invariant prints its seed" 1 "$RC" "0x1c6f70db7e06ad9b"

# TWO IS NOT A PASS, AND NEITHER IS ONE. Quint exits 1 for a violated invariant
# and for a module it cannot parse alike, and the crash on #12 leaves on a
# signal saying nothing at all — so a stage that printed no verdict is a
# could-not-run however it exited, and must not be counted as a finding.
model_repo 0.32.0
STUB_RC_run=139
run_in_repo
check "a crash mid-sweep is a could-not-run, not a violation" 2 "$RC" "could not run"

model_repo 0.32.0
STUB_RC_test=139
run_in_repo
check "a crashed suite is a could-not-run" 2 "$RC" "could not run"

model_repo 0.32.0
STUB_RC_typecheck=1
run_in_repo
check "a typecheck that said nothing is a could-not-run" 2 "$RC" "could not run"

# The same stage, exiting the same way, with something to say: a real refusal.
model_repo 0.32.0
STUB_RC_typecheck=1
STUB_OUT_typecheck="error: typechecking failed"
run_in_repo
check "a typecheck that reported an error is a finding" 1 "$RC" "does not typecheck"

# THE VERSION PIN. A different release can change what typechecks, so a
# mismatch is a refusal to judge rather than a pass on the wrong tool.
model_repo 0.31.0
run_in_repo
check "an unpinned quint version exits 2" 2 "$RC" "expected 0.32.0"

model_repo 0.32.0
rm -f "$R/node_modules/.bin/quint"
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$GITBIN" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "no quint at all exits 2" 2 "$RC" "no quint found"

# The local binary wins over PATH.
model_repo 9.9.9
run_in_repo
check "the local binary is preferred over PATH" 2 "$RC" "quint 9.9.9"

# A glob matching nothing must not read as "the model is fine".
rm -rf "$R"
mkdir -p "$R/node_modules/.bin"
git -C "$R" init -q -b main
git -C "$R" config user.email t@example.com
git -C "$R" config user.name t
printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 0.32.0; exit 0; fi\nexit 0\n' \
	> "$R/node_modules/.bin/quint"
chmod +x "$R/node_modules/.bin/quint"
printf 'placeholder\n' > "$R/README.md"
git -C "$R" add -A
run_in_repo
check "no model modules exits 2, not 0" 2 "$RC" "glob matched nothing"

OUT="$BARE/.out"
set +e
(cd "$BARE" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-model.test.sh"
