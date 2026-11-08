#!/bin/sh
# The model gate. Typechecks every Quint module, runs the unit suite, the
# ticket package's own suite, the witness modules, the refinement suites,
# and the randomized invariant runs over each instance.
#
# Quint is pinned in package.json, and the local binary wins over anything on
# PATH: a verdict that depends on which version happens to be installed is not
# a verdict. A version this gate does not expect is a could-not-run.
#
# THE RANDOMIZED RUNS ARE SEEDED FROM THE KEY WHEN A PASS CAN BE RECORDED.
# `track-record run` hands the gate the key a pass is recorded under as
# TRACK_RECORD_KEY, and its leading hex digits, as many as quint's simulator
# takes for a seed, seed both runs and every suite: a pass on record is the one
# sweep that reproduces it, and a model that differs, or anything else
# `.chug/tasks/_ci-select.sh` keys this gate on, sweeps afresh. Without a key
# nothing is seeded and every sweep is afresh.
#
# A SUITE SAMPLES A RUN THAT DRAWS AT MOST `samples` TIMES, each sample
# redrawing every choice the run makes. The only draws are the witness
# drivers' `oneOf` over the domain's `dispatchSources` and `acceptedSources`,
# and the bound is set from how many of those one run makes. It is passed
# under a seed too, where quint's own default is a single sample.
#
# AN INTERRUPT, A TERM OR A HANGUP STOPS THE GATE, which exits 2 once the
# calls it started have ended: it stops each but a call that may be fetching
# quint's evaluator, which it lets finish. A signal to the gate's whole process
# group, a Ctrl-C or a terminal hanging up, reaches quint as well, and one that
# lands during that fetch into an empty QUINT_HOME kills the download partway. Quint takes the partial archive it leaves for a whole
# one on every later call, so the evaluator never runs again until that
# archive, the `.tar.gz` in the evaluator's directory under QUINT_HOME
# (`~/.quint` unless set), is deleted.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-model: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

# Every verdict below is read out of Quint's own output — the passing count, the
# failure line, the error marker — so a colour escape in front of a numeral is
# a suite that ran reported as one that did not. `NO_COLOR` is the switch and a
# caller's `FORCE_COLOR` beats it.
unset FORCE_COLOR
export NO_COLOR=1

QUINT_VERSION="0.33.1"

if [ -x ./node_modules/.bin/quint ]; then
	QUINT=./node_modules/.bin/quint
elif command -v quint >/dev/null 2>&1; then
	QUINT=quint
else
	echo "check-model: LINTER ERROR — no quint found. Install with \`npm ci\`."
	exit 2
fi

have="$("$QUINT" --version 2>/dev/null || true)"
if [ "$have" != "$QUINT_VERSION" ]; then
	echo "check-model: LINTER ERROR — quint $have, expected $QUINT_VERSION."
	echo "check-model: a different release can change what typechecks; not guessing."
	exit 2
fi

modules="$(git ls-files 'model/*.qnt' 'model/mc/*.qnt' 'model/tests/*.qnt' || true)"
if [ -z "$modules" ]; then
	echo "check-model: LINTER ERROR — no model modules found; the glob matched nothing"
	exit 2
fi

seed=""
if [ -n "${TRACK_RECORD_KEY:-}" ]; then
	if ! printf '%s\n' "$TRACK_RECORD_KEY" | grep -Eqx '[0-9a-f]{16,}'; then
		echo "check-model: LINTER ERROR — TRACK_RECORD_KEY is not a key, so it cannot seed the randomized runs"
		exit 2
	fi
	seed="0x$(printf '%.16s' "$TRACK_RECORD_KEY")"
fi
samples=200

failed=0
errored=0
tests=0

# A COULD-NOT-RUN IS NOT A FINDING, AND THE EXIT CODE CANNOT TELL THEM APART.
# Quint exits 1 for a violated invariant, an unknown module and a parse error
# alike, and the crash behind #12 leaves on a signal with both streams empty.
# So each stage is judged on the marker it prints when it reached a verdict,
# and the output is printed either way: a failure that said nothing is exactly
# what left that crash undiagnosable.
verdict() { # <label> <status> <output> <marker> <finding-message>
	if printf '%s\n' "$3" | grep -Eq "$4"; then
		echo "ERROR $5"
		failed=$((failed + 1))
	else
		echo "check-model: LINTER ERROR — $1 could not run (exit $2)"
		errored=$((errored + 1))
	fi
	printf '%s\n' "$3" | sed 's/^/    /'
}

# A FILE A LATER STAGE TAKES IS TYPECHECKED THERE. `quint test` and `quint run`
# parse and typecheck their file and everything it imports exactly as
# `quint typecheck` does, before anything runs, and end on the same line when
# that fails; so those files are not typechecked on their own as well, and a
# stage ending on that line is a finding rather than a could-not-run.
unread='^error: (parsing|typechecking) failed$'
staged_verdict() { # <label> <status> <output> <marker> <finding-message>
	if printf '%s\n' "$3" | grep -Eq "$unread"; then
		verdict "$1" "$2" "$3" "$unread" "$1 does not typecheck"
	else
		verdict "$@"
	fi
}
unit_suites='model/tests/chuggy_test.qnt
model/tests/capacity_test.qnt
model/tests/runner_test.qnt
model/tests/execution_requirement_test.qnt
model/tests/stacking_test.qnt'
package_suite=node_modules/@kasofsk/chug-ticket-domain/model/ticket-domain/ticket_tests.qnt
witness_suite=model/tests/chuggy_witness_test.qnt
refinement_suite=model/tests/chuggy_refinement_test.qnt
ticket_instance=model/mc/mc_chuggy.qnt
runner_instance=model/mc/mc_runner.qnt
stacking_instance=model/mc/mc_stacking.qnt
staged="$unit_suites
$package_suite
$witness_suite
$refinement_suite
$ticket_instance
$runner_instance
$stacking_instance"

# EVERY CALL RUNS BESIDE THE OTHERS AND IS JUDGED IN THE ORDER WRITTEN. The
# stages below are walked twice: the first walk queues each quint call,
# `jobs` workers run the queue, and the second walk judges every call in
# turn, so neither what the gate prints nor how it exits hangs on which call
# ended first. A call no worker saw to its end is a could-not-run.
jobs=4
if ! work="$(mktemp -d)"; then
	echo "check-model: LINTER ERROR — no temporary directory to hold the calls' output"
	exit 2
fi
trap 'rm -rf "$work"' EXIT
walk=queue
calls=0
fetching=""

# Prints the pid of every process whose parent is one of <pid...>.
children() { # <pid...>
	ps -A -o pid= -o ppid= | awk -v parents=" $* " 'index(parents, " " $2 " ") { print $1 }'
}

# On an interrupt, a TERM or a hangup the gate sends TERM to every process ps
# lists as its child, so each worker stops the call it is running, and exits 2
# once they have all ended. The call that may be fetching quint's evaluator is
# left to finish rather than stopped, since a download killed partway leaves
# an archive quint takes for whole.
stop() {
	trap '' INT TERM HUP
	if [ -n "$fetching" ]; then
		echo "check-model: LINTER ERROR — interrupted while quint may be fetching its evaluator; waiting for that call to end"
	else
		echo "check-model: LINTER ERROR — interrupted before the calls completed"
		kill -TERM $(children "$$") 2>/dev/null || :
	fi
	wait
	exit 2
}
trap stop INT TERM HUP

# Queues a call in the first walk and answers 1; in the second, sets `rc` and
# `out` from what the call left.
quint_call() { # <quint args...>
	calls=$((calls + 1))
	if [ "$walk" = queue ]; then
		printf '%s\n' "$@" > "$work/$calls.args"
		return 1
	fi
	if [ ! -s "$work/$calls.rc" ]; then
		echo "check-model: LINTER ERROR — quint $* never finished"
		errored=$((errored + 1))
		return 1
	fi
	rc="$(cat "$work/$calls.rc")"
	out="$(cat "$work/$calls.out")"
	return 0
}

# Prints each of <pid...> that ps lists as running, a zombie counting as gone.
running() { # <pid...>
	ps -A -o pid= -o stat= | awk -v pids=" $* " 'index(pids, " " $1 " ") && $2 !~ /^Z/ { print $1 }'
}

# Stops <pid> and the processes under it a generation at a time, each
# generation stopped before its children are listed so none can start another
# unseen, then kills them all, collects <pid>, and looks again until none of
# them is running. Quint runs its evaluator as a process of its own, which
# would run on if only quint were killed. The walk goes down `generations` at
# most and leaves anything deeper running, and the looking stops after
# `looks`.
generations=8
looks=100
kill_tree() { # <pid>
	stopped=""
	generation="$1"
	walked=0
	while [ -n "$generation" ] && [ "$walked" -lt "$generations" ]; do
		kill -STOP $generation 2>/dev/null || :
		stopped="$stopped $generation"
		generation="$(children $generation)"
		walked=$((walked + 1))
	done
	kill -KILL $stopped 2>/dev/null || :
	wait "$1" 2>/dev/null || :
	looked=0
	while [ -n "$(running $stopped)" ] && [ "$looked" -lt "$looks" ]; do
		sleep 0.05
		looked=$((looked + 1))
	done
}

# A worker runs one call in <first> to <last> in every `jobs`, starting at
# <first>, so no call is claimed and none is run twice. Before each call it
# asks ps for its own parent. A parent other than the gate means the gate died
# without stopping it, even if nothing has collected the gate yet, and the
# worker removes the gate's temporary directory and runs nothing more. No
# answer from ps, and the worker runs nothing more and removes nothing. On
# TERM it kills the call it last started, if that is still a child of its
# own, and everything under it.
worker() { # <first> <last>
	self=""
	trap 'set +u; [ "$(ps -o ppid= -p "$!" 2>/dev/null | tr -d " ")" != "$self" ] || kill_tree "$!"; exit 2' TERM
	self="$(exec sh -c 'echo "$PPID"')"
	i="$1"
	last="$2"
	while [ "$i" -le "$last" ]; do
		parent="$(ps -o ppid= -p "$self" 2>/dev/null | tr -d ' ')"
		if [ "$parent" != "$$" ]; then
			if [ -n "$parent" ]; then
				rm -rf "$work"
			fi
			return 0
		fi
		set --
		while IFS= read -r arg; do
			set -- "$@" "$arg"
		done < "$work/$i.args"
		"$QUINT" "$@" > "$work/$i.out" 2>&1 &
		if wait "$!"; then
			status=0
		else
			status=$?
		fi
		{ echo "$status" > "$work/$i.rc"; } 2>/dev/null || :
		i=$((i + jobs))
	done
}

# Runs calls <first> to <last> on up to `jobs` workers and waits for them.
pool() { # <first> <last>
	k="$1"
	while [ "$k" -le "$2" ] && [ "$k" -lt $(($1 + jobs)) ]; do
		worker "$k" "$2" &
		k=$((k + 1))
	done
	wait
}

say() {
	[ "$walk" = queue ] || echo "$@"
}

# Quint selects only run names ending in `Test`, and exits 0 when that selects
# NOTHING: a suite whose runs were renamed passes exactly as loudly as one that
# ran. So a call is judged on the count it reports as well as on its status,
# and that total is what the success line accounts for.
run_suite() { # <label> <quint test args...>
	label="$1"
	shift
	quint_call test ${seed:+"--seed=$seed"} --max-samples="$samples" "$@" || return 0
	if [ "$rc" -ne 0 ]; then
		# A suite that ran and failed counts its failures; one that never got
		# that far prints no such line.
		staged_verdict "$label" "$rc" "$out" '^ *[0-9][0-9]* failed' "$label failed"
		return 0
	fi
	passing="$(printf '%s\n' "$out" | sed -n 's/^ *\([0-9][0-9]*\) passing.*$/\1/p')"
	if [ -z "$passing" ] || [ "$passing" -eq 0 ]; then
		echo "ERROR $label selected no tests; a suite that did not run is not a pass"
		failed=$((failed + 1))
		return 0
	fi
	tests=$((tests + passing))
}

stages() {
	say "--- typecheck"
	IFS='
'
	for m in $modules; do
		if printf '%s\n' "$staged" | grep -Fqx -- "$m"; then
			continue
		fi
		quint_call typecheck "$m" || continue
		[ "$rc" -ne 0 ] || continue
		verdict "$m" "$rc" "$out" '^error' "$m: does not typecheck"
	done
	unset IFS

	say "--- unit suite"
	for u in $unit_suites; do
		run_suite "$u" "$u"
	done

	# The package's text is installed rather than written here, so its own
	# suite is what says a quint release still reads it the way the package
	# does. A failing case is a finding like any other: the text is this
	# tree's model now.
	say "--- package suite"
	run_suite "$package_suite" "$package_suite"

	# The witness modules prove each named shape reachable and assert every
	# invariant after every step.
	#
	# They name their runs for what they are, so the selection is named here
	# too: quint's default takes `Test` and would take none of them.
	say "--- witnesses"
	for w in resume rework stage sparse gate dependency; do
		run_suite "witness $w" --match 'Witness$' \
			--main="chuggy_witness_${w}_test" "$witness_suite"
	done

	say "--- refinement"
	for r in unit witness hazard; do
		run_suite "refinement $r" --main="chuggy_refinement_${r}_test" \
			"$refinement_suite"
	done

	if [ -n "$seed" ]; then
		say "--- invariants (randomized, seeded $seed from TRACK_RECORD_KEY)"
	else
		say "--- invariants (randomized)"
	fi
	# A refuted invariant announces itself and carries the seed to reproduce it.
	if quint_call run "$ticket_instance" --main=mc_chuggy ${seed:+"--seed=$seed"} \
		--invariant=allInvariants --max-samples=2000 --max-steps=40 &&
		[ "$rc" -ne 0 ]; then
		staged_verdict "ticket instance" "$rc" "$out" '\[violation\]' \
			"the ticket instance violated an invariant"
	fi
	if quint_call run "$runner_instance" --main=mc_registered_runner ${seed:+"--seed=$seed"} \
		--invariant=allInvariants --max-samples=2000 --max-steps=30 &&
		[ "$rc" -ne 0 ]; then
		staged_verdict "registered runner instance" "$rc" "$out" '\[violation\]' \
			"registered runner instance violated an invariant"
	fi
	if quint_call run "$stacking_instance" --main=mc_stacking ${seed:+"--seed=$seed"} \
		--invariant=allInvariants --max-samples=2000 --max-steps=60 &&
		[ "$rc" -ne 0 ]; then
		staged_verdict "stacking instance" "$rc" "$out" '\[violation\]' \
			"the stacking instance violated an invariant"
	fi
}

# QUINT FETCHES ITS EVALUATOR THE FIRST TIME A CALL NEEDS IT, and nothing stops
# two calls fetching it at once and spoiling each other's download. So before
# any other call starts, one has the evaluator run a module of one run that
# holds, alone, and the gate's own stop leaves that call to finish. A gate
# whose evaluator does not run can judge no suite.
evaluator_runs() {
	quint_call test "$work/evaluator.qnt" || return 0
	if [ "$rc" -ne 0 ] || ! printf '%s\n' "$out" | grep -q '^ *1 passing'; then
		echo "check-model: LINTER ERROR — quint's evaluator did not run (exit $rc), so no suite can"
		printf '%s\n' "$out" | sed 's/^/    /'
		errored=$((errored + 1))
	fi
}
printf 'module evaluator {\n  run evaluatorTest = true\n}\n' > "$work/evaluator.qnt"
evaluator_runs
fetching=1
pool 1 1
fetching=""
walk=judge
calls=0
evaluator_runs
[ "$errored" -eq 0 ] || exit 2

walk=queue
stages
pool 2 "$calls"
walk=judge
calls=1
stages

echo "check-model: $failed failure(s), $tests test(s) run"
if [ "$errored" -ne 0 ]; then
	echo "check-model: LINTER ERROR — $errored stage(s) could not run; not a pass"
	exit 2
fi
[ "$failed" -eq 0 ]
