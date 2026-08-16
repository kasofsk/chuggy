#!/bin/sh
# Shell test for check-model.sh.
#
# Every case drives a STUB quint, because the real model run is by far the
# slowest thing this tree runs and a suite that spends that to assert a guard
# is a suite that gets excluded from the budget. What is under test here is the
# gate's refusals — the paths where it must report could-not-run rather than
# pass — and those are exactly the paths a real run never exercises.
#
# THE STUB SPEAKS QUINT'S TALLY, and that is not decoration. The gate reads the
# `N passing` line as its evidence a suite ran at all, so a stub that printed
# nothing would leave the guard unexercised — which is the shape of defect this
# file is here to prevent, not to repeat. The stub is steered by environment
# rather than by regenerating it per case: STUB_FAIL names modules it fails,
# STUB_QUIET names modules it reports with no tally at all (quint's own
# behaviour for a module with no matching runs), STUB_ZERO names modules it
# reports as having run a tally of none.
#
# THE FIXTURE MODULE NAMES ARE NOT ALL ONE WORD, and that is load-bearing. The
# gate discovers them through a character class, so a fixture whose every name
# is a single lowercase word would stay green against a class narrowed to
# `[a-z]` — which on the real model drops the modules whose names carry an
# underscore or a digit. Each file below declares one of each.
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
# this the developer's real quint would satisfy the fallback and the
# no-quint-anywhere case could never go red.
GITBIN="$WORK/gitonly"
tools_only "$GITBIN" git

model_repo() { # <quint-version> <quint-exit>
	rm -rf "$R"
	mkdir -p "$R/model/mc" "$R/model/tests" "$R/node_modules/.bin"
	git -C "$R" init -q -b main
	git -C "$R" config user.email t@example.com
	git -C "$R" config user.name t
	: > "$R/model/domain.qnt"
	printf 'module %s {\n}\n' mc_chuggy_budgeted mc_chuggy_deadline_only \
		mc_chuggy_tier2 > "$R/model/mc/mc_chuggy.qnt"
	printf 'module chuggy_test {\n}\n' > "$R/model/tests/chuggy_test.qnt"
	printf 'module %s {\n}\n' chuggy_witness_free_test \
		chuggy_witness_gate_deadline_test chuggy_witness_stage2_test \
		> "$R/model/tests/chuggy_witness_test.qnt"
	printf 'module %s {\n}\n' chuggy_refinement_unit_test \
		chuggy_refinement_hazard_seam_test chuggy_refinement_tier2_test \
		> "$R/model/tests/chuggy_refinement_test.qnt"
	cat > "$R/node_modules/.bin/quint" <<STUB
#!/bin/sh
if [ "\$1" = "--version" ]; then echo "$1"; exit 0; fi
main=""
for a in "\$@"; do case "\$a" in --main=*) main=\${a#--main=} ;; esac; done
[ -n "\$main" ] || main=unit
printf '  %s\n' "\$main"
case " \${STUB_QUIET:-} " in *" \$main "*) exit 0 ;; esac
case " \${STUB_ZERO:-} " in *" \$main "*) printf '\n  0 passing (1ms)\n'; exit 0 ;; esac
case " \${STUB_FAIL:-} " in
*" \$main "*) printf '    1) aTest failed after 1 test(s)\n\n  1 failed\n'; exit 1 ;;
esac
printf '    ok aTest passed 1 test(s)\n\n  1 passing (1ms)\n'
exit $2
STUB
	chmod +x "$R/node_modules/.bin/quint"
	git -C "$R" add -A
}

run_in_repo() { # [<VAR=value>...] — env for the stub to read
	OUT="$WORK/.out"
	set +e
	(cd "$R" && env "$@" "$SUT") >"$OUT" 2>&1
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

# --- Discovery ---------------------------------------------------------------
# The gate used to name its witness and refinement modules in `for` loops here,
# and its mc instances in a third list. The cases below are the ones those
# lists could not have: they move the model source and watch the gate follow
# it, or refuse to.

# 8. A MODULE THE MODEL GAINED IS A MODULE THE GATE RUNS. This is the finding:
#    with a typed list, appending a witness module whose obligation is false ran
#    it nowhere and the gate printed a clean tally. Driven at all THREE loops,
#    because each is its own list and reverting any one of them alone is a
#    change the other two cases would not notice — the instance loop reaching
#    `quint run` rather than `quint test`, and reporting differently for it.
appended_module() { # <model file> <module name> <expected finding>
	model_repo 0.32.0 0
	printf 'module %s {\n}\n' "$2" >> "$R/$1"
	git -C "$R" add -A
	run_in_repo STUB_FAIL="$2"
	check "an appended module in $1 is run and its failure named" 1 "$RC" "$3"
}
appended_module model/tests/chuggy_witness_test.qnt chuggy_witness_appended_test \
	"ERROR witness chuggy_witness_appended_test failed"
appended_module model/tests/chuggy_refinement_test.qnt chuggy_refinement_appended_test \
	"ERROR refinement chuggy_refinement_appended_test failed"
appended_module model/mc/mc_chuggy.qnt mc_chuggy_appended \
	"ERROR instance mc_chuggy_appended violated an invariant"

# 9. Discovery matching nothing is a could-not-run, per source. Each loop reads
#    a different file with a different pattern, so each refusal is driven; the
#    message names the file so the reader knows which scan came up empty.
for empty in \
	"witness:model/tests/chuggy_witness_test.qnt" \
	"refinement:model/tests/chuggy_refinement_test.qnt" \
	"instance:model/mc/mc_chuggy.qnt"; do
	model_repo 0.32.0 0
	printf 'val notAModule = 1\n' > "$R/${empty#*:}"
	git -C "$R" add -A
	run_in_repo
	check "no ${empty%%:*} modules exits 2, not 0" 2 "$RC" \
		"no ${empty%%:*} modules declared in ${empty#*:}"
done

# 9b. A DECLARATION THE PATTERN CANNOT READ IS A RESIDUE, NOT AN ABSENCE. The
#     `module NAME {` shape the scan matches is one of several valid Quint
#     spellings, and the original attack reproduces verbatim with the brace
#     moved to the next line: the module typechecks, fails under `quint test`,
#     and is invisible to a scan that reads the brace. The count of
#     declarations in the file against the count the pattern took is what makes
#     the difference visible, and it covers every other spelling and a narrowed
#     character class along with it.
model_repo 0.32.0 0
printf 'module chuggy_witness_hidden_test\n{\n}\n' \
	>> "$R/model/tests/chuggy_witness_test.qnt"
git -C "$R" add -A
run_in_repo STUB_FAIL=chuggy_witness_hidden_test
check "a declaration the scan cannot read exits 2, not 0" 2 "$RC" \
	"scan did not"
check "the unmatched module is named" 2 "$RC" "chuggy_witness_hidden_test"

# 9c. A suite file that is not there at all. The cases above all have the file
#     and empty it; this is the branch where discovery has nothing to open, and
#     it is a different refusal with a different message.
model_repo 0.32.0 0
rm -f "$R/model/tests/chuggy_refinement_test.qnt"
run_in_repo
check "an absent suite file exits 2, not 0" 2 "$RC" \
	"no model/tests/chuggy_refinement_test.qnt to read refinement modules from"

# 10. A SUITE THAT RAN NOTHING IS NOT A SUITE THAT PASSED. `quint test` exits 0
#     on a module with no `*Test` runs, so a renamed run empties a suite in
#     silence — the one way this gate could report clean having checked nothing.
#     Both spellings of nothing: quint omitting the tally line, and a tally of
#     zero, which is the reading a bare digit class would have let through.
model_repo 0.32.0 0
run_in_repo STUB_QUIET=chuggy_witness_free_test
check "a suite reporting no tally exits 2, not 0" 2 "$RC" "reported no tests run"
check "the empty suite is named" 2 "$RC" "witness chuggy_witness_free_test"

model_repo 0.32.0 0
run_in_repo STUB_ZERO=chuggy_refinement_unit_test
check "a tally of zero exits 2, not 0" 2 "$RC" \
	"refinement chuggy_refinement_unit_test reported no tests run"

done_ "check-model.test.sh"
