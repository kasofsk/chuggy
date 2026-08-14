#!/bin/sh
# Shell test for check-shell-quoting.sh — no NATS, no Docker, no cargo.
#
# It drives the gate in explicit-path mode over fixtures in a temp dir and
# asserts the properties the gate rests on:
#
#   1. The historical instance is caught. The exact line from
#      the predecessor's worker build script — an apostrophe in a
#      `${WORKER_SLOTS_MAX:-…}` default — fails (rc 1) and is named with its
#      line number.
#   1b-1d. The rest of the expansion forms are caught too, because the gate
#      claims the class and not one spelling of it: the colon-less operator
#      (`${V-word}`), a positional parameter (`${1:-word}`), and a heredoc body,
#      whose lines carry no surrounding quotes of their own yet are read as
#      quoted by both shells.
#   2. Its fix passes. The same message with the apostrophe written out of the
#      prose is clean (rc 0), so the gate is satisfied by the shape the fix took
#      rather than by an escape.
#   3. A command substitution in a default is NOT flagged. `$(…)` opens a fresh
#      parsing context and quotes normally in both shells, so
#      `${DIR:-$(cd "$(dirname "$0")" && pwd)}` — which .chug/tasks/android-proof.sh
#      really carries — is correct code and a gate that flags it is noise.
#   3b-3c. Neither is an expansion in an UNQUOTED word, nor one in a heredoc
#      with a quoted delimiter. Both are measured below rather than assumed:
#      the first agrees between the shells and the second expands in neither, so
#      flagging them would be noise of exactly the kind that gets a gate tuned
#      away. 3b is a shape the predecessor really carried.
#   4. The whole tree is clean, in the gate's own default mode. That is the
#      claim the CI wiring makes, and it is worth one assertion rather than a
#      reader's trust.
#
# Plus: a broken gate is rc 2, never a pass.
#
# It also pins the premise, because the premise is the whole reason the gate
# exists and nothing else in this repo asserts it: a POSIX shell accepts the
# fixture outright — so no `sh -n` sweep can stand in for this gate — and bash
# reads the same bytes as something else. Whether bash then *rejects* the file
# depends on what follows it (a later apostrophe closed the
# run, so `bash -n` passed there and only the bindings moved), which is why the
# assertion is on the disagreement rather than on either verdict. The premise
# has a second half, and it is what draws the gate's boundary: the shells AGREE
# about the unquoted form, so case 3b is an exclusion the measurement earns
# rather than a hole. The bash half is skipped when there is no bash — but it is
# announced, never silent.
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

# 1. The instance. Reproduced as the predecessor carried it: the expansion sits
#    in the `then` branch of the very test whose passing arm the mis-parse
#    swallows, which is what made it invisible until a node declared host mode.
{
	echo 'if [ "${WORKER_SLOTS_MAX:-}" != "1" ]; then'
	echo "  CAP_MAX=\"WORKER_SLOTS_MAX is '\${WORKER_SLOTS_MAX:-<unset: daemon default is this node${APOSTROPHE}s CPU count>}'\""
	echo 'fi'
	echo 'HOST_ROOT_PROBE="mkdir -p /tmp/x"'
	echo 'echo "$HOST_ROOT_PROBE"'
} > "$WORK/broken.sh"
run_sut "$WORK/broken.sh"
check "an apostrophe in a \${VAR:-word} default is a finding" 1 "$RC" "broken.sh:2:"

# 1b. The colon-less operator. bash reads the word of `${V-w}` exactly as it
#     reads `${V:-w}`, so a gate that saw only the colon form would pass the
#     reported bug back with one character removed.
echo "MSG=\"max is '\${WORKER_SLOTS_MAX-<unset: this node${APOSTROPHE}s CPU count>}'\"" > "$WORK/nocolon.sh"
run_sut "$WORK/nocolon.sh"
check "an apostrophe in a \${VAR-word} default is a finding" 1 "$RC" "nocolon.sh:1:"

# 1c. A positional parameter, which is the commonest default expansion in this
#     tree (30+ sites, `.chug/tasks/ci.sh` and `.githooks/pre-commit` among them).
echo "LABEL=\"stage \${1:-the caller${APOSTROPHE}s own}\"" > "$WORK/positional.sh"
run_sut "$WORK/positional.sh"
check "an apostrophe in a \${1:-word} default is a finding" 1 "$RC" "positional.sh:1:"

# 1d. A heredoc body with a plain delimiter. Nothing on the line is quoted, yet
#     both shells expand it and only bash reads the apostrophe — and this repo
#     writes its fake scripts through heredocs.
{
	echo 'cat <<EOF'
	echo "  slots: \${WORKER_SLOTS-<unset: this node${APOSTROPHE}s CPU count>}"
	echo 'EOF'
} > "$WORK/heredoc.sh"
run_sut "$WORK/heredoc.sh"
check "an apostrophe in a heredoc body default is a finding" 1 "$RC" "heredoc.sh:2:"

# 2. The fix, which is the prose rewritten rather than the quote escaped.
sed "s/this node${APOSTROPHE}s CPU count/the CPU count of this node/" "$WORK/broken.sh" > "$WORK/fixed.sh"
run_sut "$WORK/fixed.sh"
check "the same message without the apostrophe passes" 0 "$RC" "$CLEAN"

# 3. Command substitution inside a default is correct code in both shells.
{
	echo 'FIXTURE="${CHUG_FIXTURE_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/fixtures/mobile}"'
	echo 'echo "$FIXTURE"'
} > "$WORK/cmdsub.sh"
run_sut "$WORK/cmdsub.sh"
check "a \$(…) in a default is not a finding" 0 "$RC" "$CLEAN"

# 3b. An UNQUOTED expansion. POSIX has the word expanded like any other word
#     here, so the shells agree (asserted below) and the quotes are load-bearing
#     — they are what makes this one `env` argument instead of two.
{
	echo 'env -i \'
	echo '  ${3:+GOOGLE_APPLICATION_CREDENTIALS="$3"} \'
	echo '  sh -c :'
} > "$WORK/unquoted.sh"
run_sut "$WORK/unquoted.sh"
check "an unquoted expansion is not a finding" 0 "$RC" "$CLEAN"

# 3c. A heredoc with a quoted delimiter performs no expansion at all, so there
#     is nothing for the two shells to disagree about.
{
	echo "cat <<${APOSTROPHE}EOF${APOSTROPHE}"
	echo "  slots: \${WORKER_SLOTS-<unset: this node${APOSTROPHE}s CPU count>}"
	echo 'EOF'
} > "$WORK/heredoc-quoted.sh"
run_sut "$WORK/heredoc-quoted.sh"
check "a quoted-delimiter heredoc is not a finding" 0 "$RC" "$CLEAN"

# 4. The tree the gate is wired over, in its own default mode.
( cd "$HERE/../.." && "$SUT" > "$OUT" 2>&1 ) && RC=0 || RC=$?
check "the whole tree is clean" 0 "$RC" "$CLEAN"

# 5. A gate that cannot run says so (rc 2) instead of reporting a clean tree.
mkdir -p "$WORK/bin"
OUT="$WORK/out"
set +e
env PATH="$WORK/bin" /bin/sh "$SUT" "$WORK/fixed.sh" > "$OUT" 2>&1
RC=$?
set -e
check "no awk is a broken gate, not a pass" 2 "$RC" "no \`awk\` on PATH"

# The premise: a strict POSIX shell accepts the fixture outright, and bash reads
# it as something else. If this ever stops holding, the gate guards nothing.
#
# NAME THE SHELL rather than trusting /bin/sh. The script this ports from ran on
# Debian, where /bin/sh IS dash, so comparing /bin/sh against bash compared the
# two shells that diverge. Here /bin/sh is bash, so that comparison measures a
# shell against itself and reports no disagreement — a premise check that fails
# for the wrong reason and would have been "fixed" by deleting it.
#
# The hazard is also not live on this machine and it is worth saying so: with
# bash on both sides there is nothing here to diverge. It arrives when the gate
# scripts run in a Linux container as job evaluators, which is the whole reason
# the rule is carried now rather than then.
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
