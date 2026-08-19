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

# The third argument is what the stub reports for a `test` call. It defaults to
# one passing test, because a `quint test` that selects nothing prints no such
# line and the gate must be able to tell the two apart.
model_repo() { # <quint-version> <quint-exit> [passing-line]
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
if [ "\$1" = "test" ]; then echo "${3-  1 passing (1ms)}"; fi
exit $2
STUB
	chmod +x "$R/node_modules/.bin/quint"
	git -C "$R" add -A
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
model_repo 0.32.0 0
run_in_repo
check "a clean model run exits 0" 0 "$RC" "0 failure(s), 13 test(s) run"

# A SUITE THAT SELECTED NOTHING IS NOT A SUITE THAT PASSED. Quint runs only the
# names its match selects and exits 0 when that is none of them, so a renamed
# run would otherwise leave the gate reporting a clean unit suite over a file
# it never executed.
model_repo 0.32.0 0 ""
run_in_repo
check "a suite selecting no tests is a finding" 1 "$RC" "selected no tests"

# A failing quint call is a finding, not a could-not-run.
model_repo 0.32.0 1
run_in_repo
check "a failing quint call is a finding" 1 "$RC" "failure(s)"

# WHAT THE FAILING RUN SAID IS KEPT. A suite that fails once and passes on the
# rerun leaves nothing to diagnose if its output went to /dev/null, so the
# stub's complaint has to reach the reader.
model_repo 0.32.0 1 "the witness said something worth reading"
run_in_repo
check "a failing suite prints what it said" 1 "$RC" "worth reading"

# THE VERSION PIN. A different release can change what typechecks, so a
# mismatch is a refusal to judge rather than a pass on the wrong tool.
model_repo 0.31.0 0
run_in_repo
check "an unpinned quint version exits 2" 2 "$RC" "expected 0.32.0"

model_repo 0.32.0 0
rm -f "$R/node_modules/.bin/quint"
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$GITBIN" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "no quint at all exits 2" 2 "$RC" "no quint found"

# The local binary wins over PATH.
model_repo 9.9.9 0
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
