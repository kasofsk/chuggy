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

# Under a wrapped `ci.sh` this suite is handed a key of its own, which would
# seed every case's randomized runs; the cases that want one set it.
unset TRACK_RECORD_KEY

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
# gate reads is what a caller's environment would have made of it, and writes
# each call's arguments to STUB_LOG when a case names one.
#
# The call that has the gate's evaluator module run passes whatever the
# `test` knobs say, unless STUB_RC_evaluator and STUB_OUT_evaluator say
# otherwise.
#
# The rest of the knobs are about the calls running side by side and being
# stopped. Each waiting knob gives up past a cap.
# - STUB_HOLD: a `typecheck` call answers only once a `run` call has created
#   the file it names, so it ends only where calls overlap.
# - STUB_WAIT: a suite's `test` call answers only once the file it names
#   exists.
# - STUB_FETCH: the first `test` or `run` call to start takes a while, as a
#   fetch would, and any other that starts meanwhile is written to the file
#   STUB_FETCH names with `.overlap` after it.
# - STUB_STALL=<file>: the call whose last argument is that file starts a
#   child that starts a child of its own that sleeps, and waits for it in
#   place of answering. To STUB_PIDS the call writes a line of its own pid,
#   its child's and its worker's, and the child writes its child's.
# - STUB_BURST: the stalled call, once that file exists, goes on starting
#   children that sleep, up to a cap, each writing its pid to STUB_PIDS.
# - STUB_EVAL_HOLD: the evaluator call writes its pid to the file named with
#   `.pid` after it, answers only once the file itself exists, and then
#   writes a line to the one named with `.done` after it.
# - STUB_WORKERS: each call writes the pid of the process that started it
#   there.
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
if [ -n "\${STUB_LOG-}" ]; then echo "\$*" >> "\$STUB_LOG"; fi
if [ -n "\${STUB_WORKERS-}" ]; then echo "\$PPID" >> "\$STUB_WORKERS"; fi
sub="\$1"
for arg in "\$@"; do last="\$arg"; done
case "\$last" in */evaluator.qnt) evaluator=1 ;; *) evaluator="" ;; esac
if [ -n "\${STUB_FETCH-}" ] && { [ "\$sub" = test ] || [ "\$sub" = run ]; }; then
	if ( set -C; : > "\$STUB_FETCH.first" ) 2>/dev/null; then
		: > "\$STUB_FETCH.busy"
		sleep 0.3
		rm -f "\$STUB_FETCH.busy"
	elif [ -e "\$STUB_FETCH.busy" ]; then
		echo "\$*" >> "\$STUB_FETCH.overlap"
	fi
fi
if [ -n "\${STUB_WAIT-}" ] && [ "\$sub" = test ] && [ -z "\$evaluator" ]; then
	n=0
	while [ ! -e "\$STUB_WAIT" ]; do
		n=\$((n + 1))
		if [ "\$n" -gt 600 ]; then exit 3; fi
		sleep 0.05
	done
fi
if [ -n "\${STUB_EVAL_HOLD-}" ] && [ -n "\$evaluator" ]; then
	echo "\$\$" > "\$STUB_EVAL_HOLD.pid"
	n=0
	while [ ! -e "\$STUB_EVAL_HOLD" ]; do
		n=\$((n + 1))
		if [ "\$n" -gt 600 ]; then exit 3; fi
		sleep 0.05
	done
	echo finished >> "\$STUB_EVAL_HOLD.done"
fi
if [ -n "\${STUB_STALL-}" ] && [ "\$last" = "\$STUB_STALL" ]; then
	sh -c 'sleep 30 & echo "\$!" >> "\$STUB_PIDS"; wait' &
	echo "\$\$ \$! \$PPID" >> "\$STUB_PIDS"
	if [ -n "\${STUB_BURST-}" ]; then
		n=0
		while [ ! -e "\$STUB_BURST" ] && [ "\$n" -lt 600 ]; do
			n=\$((n + 1))
			sleep 0.05
		done
		n=0
		while [ "\$n" -lt 2000 ]; do
			sleep 30 &
			echo "\$!" >> "\$STUB_PIDS"
			n=\$((n + 1))
		done
	fi
	wait
	exit 3
fi
if [ -n "\${STUB_HOLD-}" ] && [ "\$sub" = run ]; then : > "\$STUB_HOLD"; fi
if [ -n "\${STUB_HOLD-}" ] && [ "\$sub" = typecheck ]; then
	n=0
	while [ ! -e "\$STUB_HOLD" ]; do
		n=\$((n + 1))
		if [ "\$n" -gt 600 ]; then exit 3; fi
		sleep 0.05
	done
fi
eval "out=\\\${STUB_OUT_\$sub-}"
eval "rc=\\\${STUB_RC_\$sub-0}"
if [ -n "\$evaluator" ]; then
	rc="\${STUB_RC_evaluator-0}"
	out="\${STUB_OUT_evaluator-  1 passing (1ms)}"
fi
if [ "\$last" = model/ticket-domain/ticket_tests.qnt ] && [ -n "\${STUB_PKG_RC-}" ]; then
	rc="\$STUB_PKG_RC"; out="\$STUB_PKG_OUT"
fi
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
model_repo 0.33.1
run_in_repo
check "a clean model run exits 0" 0 "$RC" "0 failure(s), 14 test(s) run"

# A CALLER'S FORCE_COLOR MUST NOT REACH QUINT. Every verdict is read out of
# Quint's own text, so a colour escape in front of the passing count reads as a
# suite that selected nothing — a clean model reported as a wall of findings,
# out of an environment variable the gate never set. `NO_COLOR` does not answer
# it, because FORCE_COLOR beats NO_COLOR and the stub above behaves that way.
model_repo 0.33.1
FORCE_COLOR=1
export FORCE_COLOR
run_in_repo
unset FORCE_COLOR
check "a caller's FORCE_COLOR does not hide a suite that ran" 0 "$RC" "14 test(s) run"

# A SUITE THAT SELECTED NOTHING IS NOT A SUITE THAT PASSED. Quint runs only the
# names its match selects and exits 0 when that is none of them, so a renamed
# run would otherwise leave the gate reporting a clean unit suite over a file
# it never executed.
model_repo 0.33.1
STUB_OUT_test=""
run_in_repo
check "a suite selecting no tests is a finding" 1 "$RC" "selected no tests"

# A SUITE THAT RAN AND FAILED IS A FINDING, and what it said is kept: a witness
# that fails once and passes on the rerun leaves nothing to diagnose if the run
# that failed went to /dev/null.
model_repo 0.33.1
STUB_RC_test=1
STUB_OUT_test="  1 passing (1ms)
  1 failed — the witness said something worth reading"
run_in_repo
check "a suite that ran and failed is a finding" 1 "$RC" "failure(s)"
check "a failing suite prints what it said" 1 "$RC" "worth reading"

# THE PACKAGE'S SUITE IS THIS TREE'S. Its text is vendored into the model, so a
# case of it failing under the pinned quint is a finding here, not a stage that
# could not run.
model_repo 0.33.1
STUB_PKG_RC=1
STUB_PKG_OUT="  21 passing (1ms)
  1 failed"
export STUB_PKG_RC STUB_PKG_OUT
run_in_repo
unset STUB_PKG_RC STUB_PKG_OUT
check "a failing package suite is a finding" 1 "$RC" "ticket_tests.qnt failed"

# A VIOLATED INVARIANT IS A FINDING, and its seed reaches the reader, because
# the whole value of a randomized refutation is reproducing it.
model_repo 0.33.1
STUB_RC_run=1
STUB_OUT_run="[violation] Found an issue
Use --seed=0x1c6f70db7e06ad9b to reproduce."
run_in_repo
check "a refuted invariant is a finding" 1 "$RC" "violated an invariant"
check "a refuted invariant prints its seed" 1 "$RC" "0x1c6f70db7e06ad9b"

# A PASS THAT CAN BE RECORDED IS ONE SWEEP THAT REPRODUCES IT. With a key,
# both randomized runs and every suite are seeded from its leading hex digits,
# and the stage says so; without one, nothing is. A key that is no key seeds
# nothing and runs nothing.
key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
model_repo 0.33.1
STUB_LOG="$WORK/quint.log"
export STUB_LOG
: > "$STUB_LOG"
OUT="$WORK/.out"
set +e
(cd "$R" && TRACK_RECORD_KEY="$key" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "a key names the seed it gives the runs" 0 "$RC" "seeded 0x0123456789abcdef from TRACK_RECORD_KEY"
seeded="$(grep '^run ' "$STUB_LOG" | grep -c -- ' --seed=0x0123456789abcdef ' || true)"
printf 'seeded runs %s\n' "$seeded" >> "$OUT"
check "a key seeds both randomized runs" 0 "$RC" "seeded runs 2"
# Each suite carries the gate's sample bound beside the seed, because under a
# seed quint's own default is a single sample, which would try one draw of
# each run and no other.
suites="$(grep '^test ' "$STUB_LOG" | grep -vc '/evaluator\.qnt$' || true)"
seeded="$(grep '^test ' "$STUB_LOG" | grep -c -- '^test --seed=0x0123456789abcdef --max-samples=200 ' || true)"
printf 'seeded suites %s of %s\n' "$seeded" "$suites" >> "$OUT"
check "a key seeds every suite and bounds its samples" 0 "$RC" "seeded suites 14 of 14"
: > "$STUB_LOG"
run_in_repo
seeded="$(grep -c -- '--seed' "$STUB_LOG" || true)"
printf 'seeded calls %s\n' "$seeded" >> "$OUT"
check "without a key no run is seeded" 0 "$RC" "seeded calls 0"
bounded="$(grep -c -- '^test --max-samples=200 ' "$STUB_LOG" || true)"
printf 'bounded suites %s\n' "$bounded" >> "$OUT"
check "without a key every suite still bounds its samples" 0 "$RC" "bounded suites 14"
: > "$STUB_LOG"
OUT="$WORK/.out"
set +e
(cd "$R" && TRACK_RECORD_KEY="not-a-key" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "a key that is no key is a could-not-run" 2 "$RC" "TRACK_RECORD_KEY is not a key"
printf 'calls %s\n' "$(grep -c '' "$STUB_LOG" || true)" >> "$OUT"
check "a key that is no key runs nothing" 2 "$RC" "calls 0"
unset STUB_LOG

# TWO IS NOT A PASS, AND NEITHER IS ONE. Quint exits 1 for a violated invariant
# and for a module it cannot parse alike, and the crash on #12 leaves on a
# signal saying nothing at all — so a stage that printed no verdict is a
# could-not-run however it exited, and must not be counted as a finding.
model_repo 0.33.1
STUB_RC_run=139
run_in_repo
check "a crash mid-sweep is a could-not-run, not a violation" 2 "$RC" "could not run"

model_repo 0.33.1
STUB_RC_test=139
run_in_repo
check "a crashed suite is a could-not-run" 2 "$RC" "could not run"

model_repo 0.33.1
STUB_RC_typecheck=1
run_in_repo
check "a typecheck that said nothing is a could-not-run" 2 "$RC" "could not run"

# The same stage, exiting the same way, with something to say: a real refusal.
model_repo 0.33.1
STUB_RC_typecheck=1
STUB_OUT_typecheck="error: typechecking failed"
run_in_repo
check "a typecheck that reported an error is a finding" 1 "$RC" "does not typecheck"

# A FILE A LATER STAGE TAKES IS TYPECHECKED BY THAT STAGE, and only there: the
# typecheck pass leaves it out, so the stage's own refusal to read it is the
# finding, and a could-not-run in its place would let a model that does not
# typecheck end on 2.
model_repo 0.33.1
STUB_LOG="$WORK/quint.log"
export STUB_LOG
: > "$STUB_LOG"
run_in_repo
for f in model/domain.qnt model/mc/mc_chuggy.qnt model/tests/chuggy_test.qnt; do
	printf '%s typechecked %s, staged %s\n' "$f" \
		"$(grep -c -x -- "typecheck $f" "$STUB_LOG" || true)" \
		"$(grep -E -c -- "^(test|run) (.* )?$f( |\$)" "$STUB_LOG" || true)" >> "$OUT"
done
unset STUB_LOG
check "a file no stage takes is typechecked" 0 "$RC" "model/domain.qnt typechecked 1, staged 0"
check "a suite's file is typechecked by the suite alone" 0 "$RC" "model/tests/chuggy_test.qnt typechecked 0, staged 1"
check "an instance's file is typechecked by its run alone" 0 "$RC" "model/mc/mc_chuggy.qnt typechecked 0, staged 1"

model_repo 0.33.1
STUB_RC_test=1
STUB_OUT_test="error: typechecking failed"
run_in_repo
check "a suite whose file does not typecheck is a finding" 1 "$RC" "model/tests/chuggy_test.qnt does not typecheck"

model_repo 0.33.1
STUB_RC_run=1
STUB_OUT_run="error: parsing failed"
run_in_repo
check "an instance whose file does not parse is a finding" 1 "$RC" "ticket instance does not typecheck"

# THE CALLS RUN SIDE BY SIDE, AND THE GATE SPEAKS IN THE ORDER IT IS WRITTEN.
# The typecheck is the first call and is held until a sweep, among the last,
# has started, so it ends after the stages written below it; its finding must
# still come out ahead of them.
model_repo 0.33.1
STUB_HOLD="$WORK/swept"
export STUB_HOLD
STUB_RC_typecheck=1
STUB_OUT_typecheck="error: typechecking failed"
run_in_repo
unset STUB_HOLD
first="$(grep -e '^ERROR ' -e '^--- unit suite' "$OUT" | head -n 1)"
printf 'first said: %s\n' "$first" >> "$OUT"
check "a call held for a later one does not hold the gate" 1 "$RC" "model/domain.qnt: does not typecheck"
check "what the calls said prints in the order written" 1 "$RC" "first said: ERROR model/domain.qnt"

# A CALL NO WORKER SAW TO ITS END IS A COULD-NOT-RUN, not a stage that said
# nothing was wrong. A worker that cannot ask whether its gate is alive runs
# nothing, which leaves every call unfinished.
model_repo 0.33.1
STUB_LOG="$WORK/quint.log"
export STUB_LOG
: > "$STUB_LOG"
mkdir -p "$WORK/blind"
printf '#!/bin/sh\nexit 1\n' > "$WORK/blind/ps"
chmod +x "$WORK/blind/ps"
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$WORK/blind:$PATH" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
printf 'quint called %s time(s)\n' "$(grep -c '' "$STUB_LOG" || true)" >> "$OUT"
unset STUB_LOG
check "a worker that cannot see its gate runs nothing" 2 "$RC" "quint called 0 time(s)"
check "a call no worker saw to its end is a could-not-run" 2 "$RC" "never finished"

# A WORKER THAT CANNOT ASK REMOVES NOTHING. ps answers nothing once, the second
# time any worker asks it about itself, and every call any worker ran is still
# judged on what it said.
model_repo 0.33.1
STUB_LOG="$WORK/quint.log"
export STUB_LOG
: > "$STUB_LOG"
rm -rf "$WORK/flaky"
mkdir -p "$WORK/flaky"
cat > "$WORK/flaky/ps" <<FLAKY
#!/bin/sh
p=""
prev=""
for a in "\$@"; do
	if [ "\$prev" = -p ]; then p="\$a"; fi
	prev="\$a"
done
if [ -n "\$p" ]; then
	if grep -qx "\$p" "$WORK/flaky/asked" 2>/dev/null &&
		( set -C; : > "$WORK/flaky/failed" ) 2>/dev/null; then
		exit 1
	fi
	echo "\$p" >> "$WORK/flaky/asked"
fi
exec $(command -v ps) "\$@"
FLAKY
chmod +x "$WORK/flaky/ps"
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$WORK/flaky:$PATH" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
unset STUB_LOG
lost=0
while IFS= read -r call; do
	if grep -qF -- "quint $call never finished" "$OUT"; then
		lost=$((lost + 1))
	fi
done < "$WORK/quint.log"
printf 'calls that ran but were judged never finished %s\n' "$lost" >> "$OUT"
check "a worker that cannot ask leaves the others' calls to be judged" 2 "$RC" \
	"calls that ran but were judged never finished 0"

# NO TWO CALLS FETCH THE EVALUATOR AT ONCE. Quint fetches it on the first call
# that needs it, so nothing may start while that call is in flight.
model_repo 0.33.1
STUB_FETCH="$WORK/fetch"
export STUB_FETCH
rm -f "$STUB_FETCH".*
run_in_repo
unset STUB_FETCH
overlap=0
if [ -e "$WORK/fetch.overlap" ]; then
	overlap="$(grep -c '' "$WORK/fetch.overlap")"
fi
printf 'calls started beside the first evaluator call %s\n' "$overlap" >> "$OUT"
check "nothing starts while the evaluator may be fetched" 0 "$RC" "calls started beside the first evaluator call 0"

# A GATE WHOSE EVALUATOR DOES NOT RUN CAN JUDGE NO SUITE, and starts no other
# call that would fetch it again.
model_repo 0.33.1
STUB_LOG="$WORK/quint.log"
export STUB_LOG
: > "$STUB_LOG"
STUB_RC_evaluator=1
STUB_OUT_evaluator="tar: Unexpected EOF in archive"
export STUB_RC_evaluator STUB_OUT_evaluator
run_in_repo
unset STUB_RC_evaluator STUB_OUT_evaluator STUB_LOG
printf 'quint called %s time(s)\n' "$(grep -c '' "$WORK/quint.log" || true)" >> "$OUT"
check "an evaluator that does not run is a could-not-run" 2 "$RC" "evaluator did not run"
check "an evaluator that does not run starts nothing else" 2 "$RC" "quint called 1 time(s)"

model_repo 0.33.1
STUB_OUT_evaluator="  0 passing (1ms)"
export STUB_OUT_evaluator
run_in_repo
unset STUB_OUT_evaluator
check "an evaluator that passes nothing is a could-not-run" 2 "$RC" "evaluator did not run"

# THE GATE'S TEMPORARY DIRECTORY IS ITS OWN. One it cannot make is a
# could-not-run, and one it made is gone when it ends.
model_repo 0.33.1
OUT="$WORK/.out"
set +e
(cd "$R" && TMPDIR="$WORK/no-such-dir/tmp" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "a TMPDIR it cannot write in is a could-not-run" 2 "$RC" "no temporary directory"

model_repo 0.33.1
T="$WORK/tmp-run"
rm -rf "$T"
mkdir -p "$T"
OUT="$WORK/.out"
set +e
(cd "$R" && TMPDIR="$T" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
printf 'left in TMPDIR %s\n' "$(ls -A "$T" | grep -c '' || true)" >> "$OUT"
check "a run leaves nothing in its TMPDIR" 0 "$RC" "left in TMPDIR 0"

# The cases that stop the gate run it under `parent`, which starts it in the
# background with INT, TERM and HUP at their defaults, writes its pid to
# $P/pid, collects it and writes its exit status to $P/rc. When it collects
# the gate it writes to $P/alive each pid in STUB_PIDS still running, and
# kills it. While a fifo sits at $P/hold, it collects nothing until something
# is written there, so a gate that died stays a zombie, as under an init that
# never collects. On Linux with python3 it also adopts whatever the gate leaves
# behind, collects that too, and writes each such pid to $P/collected;
# elsewhere that goes to init.
P="$WORK/parent"
PARENT='import ctypes, os, signal, subprocess, sys
d, cmd = sys.argv[1], sys.argv[2:]
PR_SET_CHILD_SUBREAPER = 36
ctypes.CDLL(None, use_errno=True).prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)
for ignored in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(ignored, signal.SIG_DFL)
gate = subprocess.Popen(cmd)
open(d + "/pid", "w").write("%d\n" % gate.pid)
if os.path.exists(d + "/hold"):
    open(d + "/hold").read()
def running(pid):
    try:
        stat = open("/proc/%s/stat" % pid).read()
    except OSError:
        return False
    return stat[stat.rindex(")") + 2] != "Z"
collected = []
while True:
    try:
        pid, status = os.wait()
    except ChildProcessError:
        break
    if pid != gate.pid:
        collected.append("%d\n" % pid)
        continue
    pids = os.environ.get("STUB_PIDS", "")
    alive = [p for p in open(pids).read().split() if running(p)] if pids else []
    for p in alive:
        os.kill(int(p), signal.SIGKILL)
    open(d + "/alive", "w").write("".join(p + "\n" for p in alive))
    open(d + "/rc", "w").write("%d\n" % os.waitstatus_to_exitcode(status))
open(d + "/collected", "w").write("".join(collected))'
parent() { # <cmd...>
	if [ "$(uname -s)" = Linux ] && command -v python3 >/dev/null; then
		python3 -c "$PARENT" "$P" "$@" &
	else
		(
			perl -e '$SIG{$_} = "DEFAULT" for qw(INT TERM HUP); exec @ARGV or die "exec: $!\n"' "$@" &
			gate=$!
			echo "$gate" > "$P/pid"
			if [ -p "$P/hold" ]; then
				read -r _ < "$P/hold" || :
			fi
			if wait "$gate"; then
				status=0
			else
				status=$?
			fi
			alive=""
			if [ -n "${STUB_PIDS-}" ]; then
				alive="$(still_running $(cat "$STUB_PIDS"))"
			fi
			kill -s KILL $alive 2>/dev/null || :
			printf '%s\n' $alive | grep . > "$P/alive" || :
			echo "$status" > "$P/rc"
			: > "$P/collected"
		) &
	fi
}
# Polls up to a cap until <command...> succeeds.
await() { # <command...>
	n=0
	until "$@"; do
		n=$((n + 1))
		if [ "$n" -ge 400 ]; then
			return 0
		fi
		sleep 0.05
	done
}
# Prints how many lines <file> holds, none if it does not exist.
lines() { # <file>
	if [ -e "$1" ]; then
		grep -c '' "$1" || :
	else
		echo 0
	fi
}
has_lines() { # <file> <n>
	[ "$(lines "$1")" -ge "$2" ]
}
# Prints each of <pid...> still running, a zombie counting as gone.
still_running() { # <pid...>
	ps -A -o pid= -o stat= | awk -v pids=" $* " 'index(pids, " " $1 " ") && $2 !~ /^Z/ { print $1 }'
}
none_running() { # <pid...>
	[ -z "$(still_running "$@")" ]
}
# Succeeds once the only child ps lists for <pid> is <child>.
only_child() { # <pid> <child>
	[ "$(ps -A -o pid= -o ppid= | awk -v p="$1" '$2 == p { print $1 }')" = "$2" ]
}

# AN INTERRUPT, A TERM OR A HANGUP STOPS EVERY CALL, and everything under each,
# then exits 2. The unit suite's call stalls, and its worker has calls still to
# run; every other worker has finished before the signal arrives. The stalled
# call starts more children all the while it is being stopped. The gate must
# end before the stalled call would have, nothing may start after the signal,
# and nothing it started may outlive the gate, or be left for another process
# to collect.
for sig in INT TERM HUP; do
	model_repo 0.33.1
	T="$WORK/tmp-$sig"
	rm -rf "$T" "$P"
	mkdir -p "$T" "$P"
	STUB_STALL=model/tests/chuggy_test.qnt
	STUB_PIDS="$WORK/stalled"
	STUB_BURST="$WORK/burst"
	STUB_LOG="$WORK/quint.log"
	export STUB_STALL STUB_PIDS STUB_BURST STUB_LOG
	: > "$STUB_PIDS"
	: > "$STUB_LOG"
	rm -f "$STUB_BURST"
	OUT="$WORK/.out"
	(cd "$R" && export TMPDIR="$T" && parent "$SUT" >"$OUT" 2>&1 && wait) &
	holder=$!
	await has_lines "$P/pid" 1
	gate="$(cat "$P/pid")"
	await grep -qE '^[0-9]+ [0-9]+ [0-9]+$' "$STUB_PIDS"
	stub="$(awk 'NF == 3 { print $1 }' "$STUB_PIDS")"
	worker="$(awk 'NF == 3 { print $3 }' "$STUB_PIDS")"
	await only_child "$gate" "$worker"
	: > "$STUB_BURST"
	await has_lines "$STUB_PIDS" 12
	before="$(lines "$STUB_LOG")"
	kill -s "$sig" "$gate"
	await has_lines "$P/rc" 1
	ended=no
	if has_lines "$P/rc" 1; then
		ended=yes
	fi
	wait "$holder" || :
	after="$(lines "$STUB_LOG")"
	unset STUB_STALL STUB_PIDS STUB_BURST STUB_LOG
	RC="$(cat "$P/rc" 2>/dev/null || echo none)"
	others="$(grep -cxF -e "$stub" -e "$worker" "$P/collected" || :)"
	printf 'ended before the stalled call would have %s, calls started after the signal %s, processes running when the gate was collected %s, worker or call collected by another %s, left in TMPDIR %s\n' \
		"$ended" "$((after - before))" "$(lines "$P/alive")" "${others:-0}" \
		"$(ls -A "$T" | grep -c '' || :)" >> "$OUT"
	check "a $sig mid-run is a could-not-run" 2 "$RC" "LINTER ERROR — interrupted before the calls completed"
	check "a $sig stops every call and leaves nothing behind" 2 "$RC" \
		"ended before the stalled call would have yes, calls started after the signal 0, processes running when the gate was collected 0, worker or call collected by another 0, left in TMPDIR 0"
done

# A STOP WHILE QUINT MAY BE FETCHING ITS EVALUATOR LETS THAT CALL FINISH, since
# a download killed partway leaves an archive quint takes for whole; then the
# gate exits 2 and starts nothing else.
model_repo 0.33.1
T="$WORK/tmp-fetch"
rm -rf "$T" "$P"
mkdir -p "$T" "$P"
STUB_EVAL_HOLD="$WORK/fetch-hold"
STUB_LOG="$WORK/quint.log"
STUB_PIDS="$STUB_EVAL_HOLD.pid"
export STUB_EVAL_HOLD STUB_LOG STUB_PIDS
rm -f "$STUB_EVAL_HOLD" "$STUB_EVAL_HOLD.pid" "$STUB_EVAL_HOLD.done"
: > "$STUB_LOG"
OUT="$WORK/.out"
(cd "$R" && export TMPDIR="$T" && parent "$SUT" >"$OUT" 2>&1 && wait) &
holder=$!
await has_lines "$P/pid" 1
await has_lines "$STUB_EVAL_HOLD.pid" 1
kill -s TERM "$(cat "$P/pid")"
await grep -q 'waiting for that call to end' "$OUT"
: > "$STUB_EVAL_HOLD"
await has_lines "$P/rc" 1
wait "$holder" || :
unset STUB_EVAL_HOLD STUB_LOG STUB_PIDS
RC="$(cat "$P/rc" 2>/dev/null || echo none)"
printf 'evaluator call running when the gate was collected %s, evaluator call finished %s time(s), quint called %s time(s), left in TMPDIR %s\n' \
	"$(lines "$P/alive")" "$(lines "$WORK/fetch-hold.done")" "$(lines "$WORK/quint.log")" \
	"$(ls -A "$T" | grep -c '' || :)" >> "$OUT"
check "a TERM while the evaluator may be fetched is a could-not-run" 2 "$RC" \
	"LINTER ERROR — interrupted while quint may be fetching its evaluator"
check "a TERM while the evaluator may be fetched lets that call finish" 2 "$RC" \
	"evaluator call running when the gate was collected 0, evaluator call finished 1 time(s), quint called 1 time(s), left in TMPDIR 0"

# A GATE THAT DIED WITHOUT STOPPING ITS WORKERS LEAVES THEM NOTHING TO RUN. It
# is killed while its suites are in flight and left uncollected; no call may
# start after that, and the first worker to find the gate gone removes its
# temporary directory.
model_repo 0.33.1
T="$WORK/tmp-kill"
rm -rf "$T" "$P"
mkdir -p "$T" "$P"
mkfifo "$P/hold"
STUB_LOG="$WORK/quint.log"
STUB_WORKERS="$WORK/workers"
STUB_WAIT="$WORK/released"
export STUB_LOG STUB_WORKERS STUB_WAIT
: > "$STUB_LOG"
: > "$STUB_WORKERS"
rm -f "$STUB_WAIT"
OUT="$WORK/.out"
(cd "$R" && export TMPDIR="$T" && parent "$SUT" >"$OUT" 2>&1 && wait) &
holder=$!
await has_lines "$P/pid" 1
await has_lines "$STUB_LOG" 6
kill -s KILL "$(cat "$P/pid")"
before="$(lines "$STUB_LOG")"
: > "$STUB_WAIT"
await none_running $(sort -u "$STUB_WORKERS")
after="$(lines "$STUB_LOG")"
echo released > "$P/hold"
wait "$holder" || :
unset STUB_LOG STUB_WORKERS STUB_WAIT
printf 'calls started after the gate died %s, left in TMPDIR %s\n' \
	"$((after - before))" "$(ls -A "$T" | grep -c '' || :)" >> "$OUT"
check "a gate killed mid-run starts nothing more" 0 0 \
	"calls started after the gate died 0, left in TMPDIR 0"

# THE VERSION PIN. A different release can change what typechecks, so a
# mismatch is a refusal to judge rather than a pass on the wrong tool.
model_repo 0.31.0
run_in_repo
check "an unpinned quint version exits 2" 2 "$RC" "expected 0.33.1"

model_repo 0.33.1
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
printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 0.33.1; exit 0; fi\nexit 0\n' \
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
