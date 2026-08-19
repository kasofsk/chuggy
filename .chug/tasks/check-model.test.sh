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

model_repo() { # <quint-version> <global-fail>
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
	# The stub speaks quint's DIALECT, subcommand by subcommand, because the gate
	# now classifies on the VERDICT LINE and not the exit code (check-model.sh's
	# S3-6 fix). The literal markers below are quint 0.32.0's own — `error:
	# Tests failed`, `error: typechecking failed`, `error: Invariant violated` —
	# so a case that drives a finding proves the gate reads the same string quint
	# prints, and a case that drives a crash (exit 139 with NO marker) proves it
	# refuses rather than reporting the model false.
	#
	#   $2 (global-fail) — nonzero makes EVERY subcommand emit its genuine
	#      finding marker, the coarse "quint disagreed" the old <quint-exit> arg
	#      stood for.
	#   STUB_FAIL   modules whose test/run emits a genuine finding marker.
	#   STUB_CRASH  modules whose test/run dies on 139 with no output (flake #12).
	#   STUB_QUIET  modules whose test reports no tally at all.
	#   STUB_ZERO   modules whose test reports a tally of zero.
	#   STUB_TC     the typecheck subcommand's mode: ok (default), crash, or fail.
	#
	# The passing tally is coloured under FORCE_COLOR exactly as quint colours
	# it, escape at the very start of the line, so the gate's colour-stripping is
	# proved against output shaped like the thing that defeated it.
	cat > "$R/node_modules/.bin/quint" <<STUB
#!/bin/sh
if [ "\$1" = "--version" ]; then echo "$1"; exit 0; fi
GFAIL="$2"
sub=\$1
shift
main=""
for a in "\$@"; do case "\$a" in --main=*) main=\${a#--main=} ;; esac; done
[ -n "\$main" ] || main=unit
tally() {
	if [ -n "\${FORCE_COLOR:-}" ]; then
		printf '\n\033[32m  1 passing\033[39m\033[90m (1ms)\033[39m\n'
	else
		printf '\n  1 passing (1ms)\n'
	fi
}
case "\$sub" in
typecheck)
	case "\${STUB_TC:-ok}" in
	crash) exit 139 ;;
	fail) echo "error: typechecking failed"; exit 1 ;;
	esac
	[ "\$GFAIL" = 0 ] || { echo "error: typechecking failed"; exit 1; }
	exit 0
	;;
test)
	case " \${STUB_CRASH:-} " in *" \$main "*) exit 139 ;; esac
	case " \${STUB_QUIET:-} " in *" \$main "*) printf '  %s\n' "\$main"; exit 0 ;; esac
	case " \${STUB_ZERO:-} " in *" \$main "*) printf '\n  0 passing (1ms)\n'; exit 0 ;; esac
	case " \${STUB_FAIL:-} " in
	*" \$main "*) printf '    1) aTest failed after 1 test(s)\n\n  1 failed\n\nerror: Tests failed\n'; exit 1 ;;
	esac
	[ "\$GFAIL" = 0 ] || { printf '\n  1 failed\n\nerror: Tests failed\n'; exit 1; }
	printf '  %s\n    ok aTest passed 1 test(s)\n' "\$main"
	tally
	exit 0
	;;
run)
	case " \${STUB_CRASH:-} " in *" \$main "*) exit 139 ;; esac
	case " \${STUB_FAIL:-} " in
	*" \$main "*) echo "error: Invariant violated"; exit 1 ;;
	esac
	[ "\$GFAIL" = 0 ] || { echo "error: Invariant violated"; exit 1; }
	echo "[ok] No violation found"
	exit 0
	;;
esac
exit 0
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

# 2. A quint call disagreeing — printing its own finding verdict — is a finding,
#    not a could-not-run. The global-fail stub emits every subcommand's genuine
#    marker; the crash-vs-finding split is driven per stage further down.
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
# S3-7: the unit file was the one run bare, so a second module in it was loaded
# past. With the unit file discovered like the other three, an appended module
# is run and its failure named — the same attack, on the file the fix reached
# last.
appended_module model/tests/chuggy_test.qnt chuggy_appended_test \
	"ERROR unit chuggy_appended_test failed"

# 9. Discovery matching nothing is a could-not-run, per source. Each loop reads
#    a different file with a different pattern, so each refusal is driven; the
#    message names the file so the reader knows which scan came up empty.
for empty in \
	"unit:model/tests/chuggy_test.qnt" \
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

# 9b. A DECLARATION THE PATTERN CANNOT READ IS A DISCREPANCY, NOT AN ABSENCE.
#     `module NAME {` is one spelling among several that Quint accepts, that
#     typecheck, and that `quint test --main=` finds and runs — so a module
#     spelled any other way carries a real obligation while being invisible to
#     the scan. The gate answers by counting the lines that OPEN a declaration
#     against the number of names its pattern took.
#
#     THE SPELLINGS ARE DRIVEN INDIVIDUALLY, and the reason is the mistake the
#     first version of this audit made: it compared the pattern against a
#     second, slightly wider NAME pattern, which shared the first one's column
#     anchor and its same-line-name assumption and therefore agreed with it
#     about every spelling neither could read. Three spellings walked through
#     both scans together. A case per spelling is what says the audit is not
#     reading names any more — the last of them especially, because there is no
#     name on the line at all for a name scan to find.
hidden_spelling() { # <label> <declaration line(s)> <evidence in the refusal>
	model_repo 0.32.0 0
	printf '%b\n}\n' "$2" >> "$R/model/tests/chuggy_witness_test.qnt"
	git -C "$R" add -A
	run_in_repo STUB_FAIL=chuggy_witness_hidden_test
	check "a declaration $1 exits 2, not 0" 2 "$RC" "module here is one nothing"
	check "and the refusal shows the declaration $1" 2 "$RC" "$3"
}
hidden_spelling "with its brace on the next line" \
	'module chuggy_witness_hidden_test\n{' chuggy_witness_hidden_test
hidden_spelling "indented by spaces" \
	'  module chuggy_witness_hidden_test {' chuggy_witness_hidden_test
hidden_spelling "indented by a tab" \
	'\tmodule chuggy_witness_hidden_test {' chuggy_witness_hidden_test
# The last one asserts the COUNT rather than the name, because there is no name
# on the declaration's own line for the refusal to quote — the reader gets the
# discrepancy and a line number and goes and looks. That is the limit of a
# check that reads the keyword instead of the name, and it is also the proof
# that it does: no name scan reaches this module at all, and the gate refuses
# anyway.
hidden_spelling "with its name on the next line" \
	'module\nchuggy_witness_hidden_test {' "opens 4 module declaration(s)"

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

# --- A crash is not a finding (S3-6) ----------------------------------------
# quint's exit code is the same non-zero for a real failure, an argument error,
# a file it cannot read, and the SIGSEGV this tree tracks as flake #12 — so the
# gate used to print "the proved model is false" whenever quint merely died.
# Each pair below drives a stage twice: once with quint DYING on 139 with no
# output (→ could-not-run, exit 2), once with quint printing its genuine verdict
# marker (→ finding, exit 1). Reverting the stage to `if ! quint …; then failed`
# collapses both onto exit 1 and the could-not-run half of every pair reddens.

# 11. The test loops (witness/refinement/unit share one path).
model_repo 0.32.0 0
run_in_repo STUB_CRASH=chuggy_witness_free_test
check "a crashed test stage exits 2, not 1" 2 "$RC" \
	"witness chuggy_witness_free_test: quint exited 139 with no test verdict"
model_repo 0.32.0 0
run_in_repo STUB_FAIL=chuggy_witness_free_test
check "a genuine test failure is a finding" 1 "$RC" \
	"ERROR witness chuggy_witness_free_test failed"

# 12. The randomized-invariant loop, whose marker is the one the brief names.
model_repo 0.32.0 0
run_in_repo STUB_CRASH=mc_chuggy_budgeted
check "a crashed invariant run exits 2, not 1" 2 "$RC" \
	"instance mc_chuggy_budgeted: quint exited 139 with no violation verdict"
model_repo 0.32.0 0
run_in_repo STUB_FAIL=mc_chuggy_budgeted
check "a genuine invariant violation is a finding" 1 "$RC" \
	"ERROR instance mc_chuggy_budgeted violated an invariant"

# 13. The typecheck stage, driven through its own mode because it takes a file
#     rather than a --main. A crash there was the loudest of all: it runs over
#     every module, so a single SIGSEGV failed the whole gate.
model_repo 0.32.0 0
run_in_repo STUB_TC=crash
check "a crashed typecheck exits 2, not 1" 2 "$RC" \
	"with no verdict"
model_repo 0.32.0 0
run_in_repo STUB_TC=fail
check "a genuine typecheck failure is a finding" 1 "$RC" "does not typecheck"

# 14. COLOUR DOES NOT TURN A HEALTHY MODEL INTO COULD-NOT-RUNS (F3). Quint
#     colours its tally under FORCE_COLOR even into a pipe, escape at the very
#     start of the `N passing` line, so the tally guard — anchored at the line's
#     start — read every suite as one that ran nothing. The gate strips colour
#     before reading; dropping the strip turns this green tree amber.
model_repo 0.32.0 0
run_in_repo FORCE_COLOR=1
check "FORCE_COLOR does not defeat the tally guard" 0 "$RC" "0 failure(s)"

done_ "check-model.test.sh"
