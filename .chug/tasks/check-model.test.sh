#!/bin/sh
# Shell test for check-model.sh.
#
# Every case drives a STUB quint, because the real model run is ~50s and a
# suite that takes fifty seconds to assert a guard is a suite that gets
# excluded from the budget. What is under test here is the gate's refusals —
# the paths where it must report could-not-run rather than pass — and those are
# exactly the paths a real run never exercises.
#
# Run:  .chug/tasks/check-model.test.sh
set -eu
export LC_ALL=C

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/check-model.sh"

WORK="$(mktemp -d)"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

pass=0
fail=0
check() { # <name> <expected-rc> <actual-rc> <must-contain>
	name="$1"; want="$2"; got="$3"; needle="$4"
	if [ "$got" = "$want" ] && grep -qF "$needle" "$OUT"; then
		echo "ok   - $name (rc=$got)"
		pass=$((pass + 1))
	else
		echo "FAIL - $name: rc want=$want got=$got; expected output to contain: $needle"
		echo "----- output -----"; cat "$OUT"; echo "------------------"
		fail=$((fail + 1))
	fi
}

R="$WORK/repo"

# A PATH holding only git, so `command -v quint` can be made to fail. Without
# this the developer's real quint would satisfy the fallback and the
# no-quint-anywhere case could never go red.
GITBIN="$WORK/gitonly"
mkdir -p "$GITBIN"
ln -sf "$(command -v git)" "$GITBIN/git"

model_repo() { # <quint-version> <quint-exit>
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

# 1. Pinned version, every quint call succeeding -> clean.
model_repo 0.32.0 0
run_in_repo
check "a clean model run exits 0" 0 "$RC" "0 failure(s)"

# 2. A quint call failing is a finding, not a could-not-run.
model_repo 0.32.0 1
run_in_repo
check "a failing quint call is a finding" 1 "$RC" "failure(s)"

# 3. THE VERSION PIN. A different release can change what typechecks, so a
#    mismatch is a refusal to judge — never a pass on the wrong tool.
model_repo 0.31.0 0
run_in_repo
check "an unpinned quint version exits 2" 2 "$RC" "expected 0.32.0"

# 4. No quint anywhere -> could not run.
model_repo 0.32.0 0
rm -f "$R/node_modules/.bin/quint"
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$GITBIN" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "no quint at all exits 2" 2 "$RC" "no quint found"

# 5. The local binary WINS over PATH — a gate whose verdict depends on which
#    quint happens to be installed is not a gate.
model_repo 9.9.9 0
run_in_repo
check "the local binary is preferred over PATH" 2 "$RC" "quint 9.9.9"

# 6. No model modules -> could not run. A glob matching nothing must not read
#    as "the model is fine".
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

# 7. Outside a git checkout -> could not run.
OUT="$BARE/.out"
set +e
(cd "$BARE" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

echo "check-model.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
