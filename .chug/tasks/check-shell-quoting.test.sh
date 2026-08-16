#!/bin/sh
# Shell test for check-shell-quoting.sh — no NATS, no Docker, no cargo.
#
# It drives the gate in explicit-path mode over fixtures in a temp dir. The
# gate claims a class rather than one spelling of it, so every expansion form
# gets a case, and each exclusion gets one too: a command substitution, an
# unquoted word, a heredoc with a quoted delimiter.
#
# IT ALSO PINS THE PREMISE, which nothing else in this repo asserts: a POSIX
# shell accepts the fixture outright, so no `sh -n` sweep can stand in for this
# gate, and bash reads the same bytes as something else. The assertion is on
# the disagreement rather than on either verdict, because whether bash rejects
# the file depends on what follows it. The premise has a second half that draws
# the gate's boundary: the shells AGREE about the unquoted form, so its
# exclusion is a measurement rather than a hole. The bash half is skipped when
# there is no bash — announced, never silent.
#
# Run:  .chug/tasks/check-shell-quoting.test.sh   (exits 0 if all cases pass)
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-shell-quoting.sh"

run_sut() { # <arg>... -> writes rc to $RC, output to $OUT
	OUT="$WORK/out"
	set +e
	"$SUT" "$@" > "$OUT" 2>&1
	RC=$?
	set -e
}

APOSTROPHE="'"
CLEAN="no quote-in-default"

# The motivating shape: the expansion sits in the `then` branch of the very
# test whose passing arm the mis-parse swallows, so the two lines after it bind
# inside the `if` and run only when the guard's own check FAILS.
{
	echo 'if [ "${CHUG_CI_SUITE_TIMEOUT_SECS:-}" != "60" ]; then'
	echo "  CAP=\"the cap is '\${CHUG_CI_SUITE_TIMEOUT_SECS:-<unset: the sequencer${APOSTROPHE}s own default>}'\""
	echo 'fi'
	echo 'PROBE="quint --version"'
	echo 'echo "$PROBE"'
} > "$WORK/broken.sh"
run_sut "$WORK/broken.sh"
check "an apostrophe in a \${VAR:-word} default is a finding" 1 "$RC" "broken.sh:2:"

# The colon-less operator. bash reads the word of `${V-w}` exactly as it reads
# `${V:-w}`.
echo "MSG=\"cap is '\${CHUG_CI_SUITE_TIMEOUT_SECS-<unset: the sequencer${APOSTROPHE}s own default>}'\"" > "$WORK/nocolon.sh"
run_sut "$WORK/nocolon.sh"
check "an apostrophe in a \${VAR-word} default is a finding" 1 "$RC" "nocolon.sh:1:"

# A positional parameter, whose word bash reads as it reads a named one.
echo "LABEL=\"stage \${1:-the caller${APOSTROPHE}s own}\"" > "$WORK/positional.sh"
run_sut "$WORK/positional.sh"
check "an apostrophe in a \${1:-word} default is a finding" 1 "$RC" "positional.sh:1:"

# A heredoc body with a plain delimiter. Nothing on the line is quoted, yet
# both shells expand it and only bash reads the apostrophe.
{
	echo 'cat <<EOF'
	echo "  budget: \${CHUG_CI_SUITES_BUDGET_SECS-<unset: the sequencer${APOSTROPHE}s own default>}"
	echo 'EOF'
} > "$WORK/heredoc.sh"
run_sut "$WORK/heredoc.sh"
check "an apostrophe in a heredoc body default is a finding" 1 "$RC" "heredoc.sh:2:"

# The fix, which is the prose rewritten rather than the quote escaped.
sed "s/the sequencer${APOSTROPHE}s own default/the default the sequencer applies/" "$WORK/broken.sh" > "$WORK/fixed.sh"
run_sut "$WORK/fixed.sh"
check "the same message without the apostrophe passes" 0 "$RC" "$CLEAN"

# Command substitution inside a default is correct code in both shells.
{
	echo 'MODEL="${CHUG_MODEL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/model}"'
	echo 'echo "$MODEL"'
} > "$WORK/cmdsub.sh"
run_sut "$WORK/cmdsub.sh"
check "a \$(…) in a default is not a finding" 0 "$RC" "$CLEAN"

# An UNQUOTED expansion. POSIX has the word expanded like any other word here,
# so the shells agree (asserted below) and the quotes are load-bearing.
{
	echo 'env -i \'
	echo '  ${2:+QUINT_SEED="$2"} \'
	echo '  sh -c :'
} > "$WORK/unquoted.sh"
run_sut "$WORK/unquoted.sh"
check "an unquoted expansion is not a finding" 0 "$RC" "$CLEAN"

# A heredoc with a quoted delimiter performs no expansion at all.
{
	echo "cat <<${APOSTROPHE}EOF${APOSTROPHE}"
	echo "  budget: \${CHUG_CI_SUITES_BUDGET_SECS-<unset: the sequencer${APOSTROPHE}s own default>}"
	echo 'EOF'
} > "$WORK/heredoc-quoted.sh"
run_sut "$WORK/heredoc-quoted.sh"
check "a quoted-delimiter heredoc is not a finding" 0 "$RC" "$CLEAN"

# The tree the gate is wired over, in its own default mode.
( cd "$HERE/../.." && "$SUT" > "$OUT" 2>&1 ) && RC=0 || RC=$?
check "the whole tree is clean" 0 "$RC" "$CLEAN"

# A gate that cannot run says so instead of reporting a clean tree.
mkdir -p "$WORK/bin"
OUT="$WORK/out"
set +e
env PATH="$WORK/bin" /bin/sh "$SUT" "$WORK/fixed.sh" > "$OUT" 2>&1
RC=$?
set -e
check "no awk is a broken gate, not a pass" 2 "$RC" "no \`awk\` on PATH"

# NAME THE SHELL rather than trusting /bin/sh. On a mac /bin/sh IS bash, so
# comparing /bin/sh against bash measures a shell against itself and reports no
# disagreement — a premise check that passes for the wrong reason. The two
# shells that diverge have to be named, and dash is the one to name.
POSIX_SH=""
for cand in dash /bin/dash busybox_sh; do
	if command -v "$cand" > /dev/null 2>&1; then POSIX_SH="$cand"; break; fi
done
if [ -z "$POSIX_SH" ]; then
	echo "skip - no dash on PATH, so the divergence went unmeasured (the gate's"
	echo "       own premise is untested here; install dash to check it)"
else
	"$POSIX_SH" -n "$WORK/broken.sh" 2> /dev/null \
		&& echo "ok   - $POSIX_SH -n accepts the broken fixture (no POSIX syntax check catches this)" \
		&& pass=$((pass + 1)) \
		|| { echo "FAIL - $POSIX_SH -n rejected the fixture; the premise no longer holds"; fail=$((fail + 1)); }
fi

disagree() { # <name> <fixture> <want: yes|no>
	if [ "$("$POSIX_SH" "$2" 2>&1)" = "$(bash "$2" 2>&1)" ]; then got=no; else got=yes; fi
	if [ "$got" = "$3" ]; then
		echo "ok   - $1"
		pass=$((pass + 1))
	else
		echo "FAIL - $1: $POSIX_SH and bash disagree=$got, wanted $3"
		fail=$((fail + 1))
	fi
}

if command -v bash > /dev/null 2>&1 && [ -n "$POSIX_SH" ]; then
	disagree "$POSIX_SH and bash disagree about the flagged fixture, which is the whole class" "$WORK/broken.sh" yes
	disagree "and about the heredoc one, which carries no quotes of its own" "$WORK/heredoc.sh" yes
	disagree "but AGREE about the unquoted one, which is why case 3b is excluded" "$WORK/unquoted.sh" no
else
	echo "skip - no bash or no dash on PATH, so the disagreements went unmeasured"
fi

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
