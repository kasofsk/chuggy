#!/bin/sh
# The gate sequencer. `just check` is a thin wrapper around this, and the
# pre-commit hook calls the individual gates directly — the sequencing has one
# definition, here.
#
# THE PROTOCOL IS 0 clean, 1 finding, 2 could-not-run, and this script keeps the
# distinction all the way to its own exit. Not every gate uses all three —
# check-roster has no finding state — and a gate that could not run is a failure
# here, reported under its own heading.
#
# THE CALL IS THE ROSTER. A gate named below must exist and be executable;
# absent or unexecutable, it is a could-not-run like any other. A gate that
# belongs to a later stage is left unnamed rather than named and guarded, so
# that "not part of this run" and "should have run and was not there" cannot
# print the same.
#
# A RUN THAT RAN NOTHING SAYS SO. The gates that read text run on any change,
# so a run no gate is selected for is a run with nothing changed: it exits 0
# having proved nothing, and its last line is that and not a verdict.
#
# AN UNTRACKED FILE IS ONE MOST GATES NEVER READ. Selection counts a file no
# ignore file names as changed, but most gates list what they read with
# `git ls-files`, which leaves it out, so a clean run would vouch for a file it
# did not check. The run names those files first, and while one is left it does
# not end clean: the last line counts them, and a run that would have exited 0
# exits 1.
#
# A PASS ON RECORD IS REUSED RATHER THAN RUN AGAIN, given a Track Record token
# and a `track-record` that runs. Every gate but check-roster, doc-lint and
# check-agent-lag, and every suite, then runs under `track-record run`, keyed
# on what `.chug/tasks/_ci-select.sh` declares it reads: the tracked files its
# pathspecs match or its import graph reaches, as they are on disk, the
# ignored files among them, what sits where its tools look for settings the
# tree need not hold, and npm's record of the packages it names, or of the
# whole install. A gate declared keyed on the whole tree is keyed on every
# tracked file, every ignored file in scope and the whole install. Every key
# also holds the version of node, what else that gate's verdict reads, and the
# salt below; none holds this script, the selection or the base it selects
# against. A key on record replays its log instead of running, and only an
# exit of 0 is recorded. A reused pass is a pass and nothing more: it is
# counted as one, and the clean line says how many there were. What no key
# sees, a reused pass does not check: a file a gate reads that its declaration
# does not name, for which a key on an import graph goes on vouching across
# trees until the salt moves or `just check-full` runs the gate, a different
# server behind the same URL, a container reused by name, a file outside the
# tree or outside the scope `_ignored-inputs.sh` keys, such as a package
# changed under node_modules by hand, the build npm installed for this machine
# of a package built for each platform, and git's own state: HEAD, the index
# and history, except where a gate keys them itself. With TRACK_RECORD_OFF=1,
# or without a token, a `track-record` that runs or a record directory,
# nothing is wrapped, every gate runs itself, and one line names the first
# reason why.
#
# ONE RUN AT A TIME HOLDS A CHECKOUT. A second is refused while the first is
# alive, since two would share the logs and each other's machine, and of two
# that find a dead run's lock, one takes it over and the other is refused.
#
# A QUIET RUN PRINTS VERDICTS, NOT TRANSCRIPTS, for a reader whose every line
# costs it, such as an agent. Each gate's and each suite's output goes to its
# own log under the checkout's git directory, whose path the run prints first;
# the run prints one line per gate, the end of a red one's log under it, and
# the red ones again as its last lines, where a reader that keeps only the end
# of the output still finds them.
#
# THE UNIT STAGE IS ONE GATE OF MANY KEYS. Each closed unit suite is selected
# and keyed on its own, and the open ones together as the stage was whole, as
# `.chug/tasks/_ci-select.sh` declares; what is selected and has no pass on
# record runs in one runner, and the stage reports what it found, selected,
# reused and ran, and each red suite by name.
#
# `--only <gate>...` runs those gates and nothing else, under the key a full
# run gives each, so a pass it records is one a later run reuses.
#
# Env:
#   CHUG_CI_ALLOW_UNTRACKED=1     let a run with untracked files end clean
#   CHUG_CI_BASE=<ref>            override the default origin/main or main base
#   CHUG_CI_FULL=1                force every gate and shell suite, each run
#                                 fresh (TRACK_RECORD_FRESH=1)
#   CHUG_CI_QUIET=1               log each gate's output instead of
#                                 streaming it
#   CHUG_CI_TAIL_LINES            lines of a red gate's log a quiet run
#                                 prints, default 40
#   CHUG_CI_SHELL_SUITES=0        skip the shell-suite stage (set for the
#                                 suites themselves, so ci.test.sh cannot
#                                 recurse into a real run)
#   CHUG_CI_SUITE_TIMEOUT_SECS    per-suite cap, default 900
#   TRACK_RECORD_TOKEN, TRACK_RECORD_TOKEN_FILE
#                                 a Track Record token, or the file holding
#                                 one; either turns reuse on, and a file that
#                                 is missing or holds none does not
#   TRACK_RECORD_URL              the store, default https://track-record.vteng.io
#   TRACK_RECORD_NAMESPACE        the store's namespace, default chuggy
#   TRACK_RECORD_FRESH=1          look nothing up, and still record each pass
#   TRACK_RECORD_OFF=1            wrap nothing, though a token is set
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "ci: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

# The lock is a symlink whose target is the pid of the run holding it, since
# `ln -s` makes the name and its holder in one step and fails where the name
# exists. A holder no longer alive was killed past its trap, and its lock is
# taken over rather than left to refuse every run after it: one run claims it,
# by a symlink named for the dead pid made the same way, and removes it only
# if it still names that pid. A lock whose holder cannot be read is left alone.
git_dir="$(git rev-parse --absolute-git-dir)" || exit 2
lock="$git_dir/chug-ci.lock"
log_dir="$git_dir/chug-ci"
lock_held=""
lock_claim=""
record_dir=""
trap 'rm -f ${lock_claim:+"$lock_claim"} ${lock_held:+"$lock"}; rm -rf ${record_dir:+"$record_dir"}' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
lock_attempts_max=3
lock_attempt=0
# `ln` would make a link inside a directory of the lock's name, which no run
# of this script makes, so one is a holder that cannot be read.
while { [ -d "$lock" ] && [ ! -L "$lock" ]; } || ! ln -s "$$" "$lock" 2>/dev/null; do
	lock_attempt=$((lock_attempt + 1))
	if [ "$lock_attempt" -ge "$lock_attempts_max" ]; then
		echo "ci: LINTER ERROR — could not take $lock; this is not a pass"
		exit 2
	fi
	holder="$(readlink "$lock" 2>/dev/null || true)"
	case "$holder" in
	"" | *[!0-9]*)
		if [ -e "$lock" ] || [ -L "$lock" ]; then
			echo "ci: LINTER ERROR — $lock names no holder that can be read, so it may still be being made;"
			echo "ci: if no ci.sh is running in this checkout, remove it, then run again; this is not a pass"
			exit 2
		fi
		continue
		;;
	esac
	if kill -0 "$holder" 2>/dev/null; then
		echo "ci: LINTER ERROR — another ci.sh (pid $holder) is running in this checkout, logging to $log_dir;"
		echo "ci: wait for it to end or stop it, then run again; this is not a pass"
		exit 2
	fi
	if ! ln -s "$$" "$lock.$holder" 2>/dev/null; then
		echo "ci: LINTER ERROR — another ci.sh is taking over $lock from pid $holder, which is not running;"
		echo "ci: if none is, remove $lock.$holder, then run again; this is not a pass"
		exit 2
	fi
	lock_claim="$lock.$holder"
	if [ "$(readlink "$lock" 2>/dev/null || true)" = "$holder" ]; then
		rm -f "$lock"
	fi
	rm -f "$lock_claim"
	lock_claim=""
done
lock_held=1
rm -rf "$log_dir"
mkdir -p "$log_dir/suites"

quiet=0
if [ "${CHUG_CI_QUIET:-0}" = "1" ]; then quiet=1; fi
tail_lines="${CHUG_CI_TAIL_LINES:-40}"

# The gates `--only` may name are the ones this script runs, read off its own
# calls so the list cannot drift from them.
only=""
if [ "${1:-}" = "--only" ]; then
	shift
	known="$(sed -n 's/^run_selected_gate \([a-z-]*\) .*/\1/p' .chug/tasks/ci.sh)"
	if [ "$#" -eq 0 ]; then
		echo "ci: LINTER ERROR — --only names no gate; this is not a pass. The gates are:"
		printf '%s\n' "$known" | sed 's/^/ci:   /'
		exit 2
	fi
	for gate in "$@"; do
		if ! printf '%s\n' "$known" | grep -qxF -- "$gate"; then
			echo "ci: LINTER ERROR — --only names $gate, which is no gate here; the gates are:"
			printf '%s\n' "$known" | sed 's/^/ci:   /'
			exit 2
		fi
	done
	only=" $* "
	only_named="$*"
elif [ "$#" -gt 0 ]; then
	echo "ci: LINTER ERROR — ci.sh takes no arguments but --only <gate>...; this is not a pass"
	exit 2
fi

. ./.chug/tasks/_ci-select.sh
ci_select_init
# Every declaration is asked for what its import graph is built over before
# any is asked what it reads, so the one graph a run builds serves them all.
CI_GRAPH_DIR="$log_dir/import-graph"
# shellcheck disable=SC2046 # a gate id or a suite path a word
ci_graph_roster $(sed -n 's/^run_selected_gate \([a-z-]*\) .*/\1/p' .chug/tasks/ci.sh) \
	$(git ls-files '*.test.sh' 2>/dev/null || true)
if [ -n "$only" ]; then
	echo "ci: only run (--only $only_named)"
else
	echo "ci: $CI_SELECT_MODE run ($CI_SELECT_REASON)"
fi
if [ "$quiet" = 1 ]; then
	echo "ci: each gate's output is logged under $log_dir"
fi

# Every key carries the salt, so a new value disowns every pass on record. The
# store keeps the first pass recorded for a key, and a fresh run does not
# replace it; bump the salt when passes already recorded must stop counting
# for a reason no key can see, such as a pass found to be false.
record_salt="chuggy-ci-4"

# A key holds npm's own record of what it installed rather than the lock, since
# a lock that changed after `npm ci` names packages that are not the ones
# installed: the whole of it less each build for one platform, or the packages
# a gate names with what each depends on, both of which `_installed-inputs.sh`
# prints. It holds the ignored files too, which `_ignored-inputs.sh` prints and
# says the scope of: every one a walk of the tree can reach, or those within a
# gate's pathspecs. And it holds what `_probed-inputs.sh` prints of the places
# a gate's tools look that the tree need not hold.
record_tool_node="node --version"
record_tool_install="sh .chug/tasks/_installed-inputs.sh --whole"
record_tool_ignored="sh .chug/tasks/_ignored-inputs.sh"
record_tool_installed="sh .chug/tasks/_installed-inputs.sh"
record_tool_probed="sh .chug/tasks/_probed-inputs.sh"
record=""
# A token is read as track-record reads one, so a variable naming a file that
# is not there wraps nothing rather than announcing reuse that cannot happen.
# The binary is probed functionally — `command -v` says it exists, not that
# it runs.
record_off=""
if [ "${TRACK_RECORD_OFF:-0}" = "1" ]; then
	record_off="TRACK_RECORD_OFF=1"
elif [ -z "${TRACK_RECORD_TOKEN:-}" ] &&
	! grep -q '[^[:space:]]' "${TRACK_RECORD_TOKEN_FILE:-/dev/null}" 2>/dev/null; then
	if [ -n "${TRACK_RECORD_TOKEN_FILE:-}" ]; then
		record_off="TRACK_RECORD_TOKEN_FILE names no readable file holding a token"
	else
		record_off="no Track Record token"
	fi
elif ! track-record --version >/dev/null 2>&1; then
	record_off="no track-record that runs"
elif ! record_dir="$(mktemp -d 2>/dev/null)"; then
	record_off="no record directory could be made"
fi
if [ -n "$record_off" ]; then
	echo "ci: every gate runs fresh, and no pass on record is reused: $record_off"
else
	record=1
	TRACK_RECORD_URL="${TRACK_RECORD_URL:-https://track-record.vteng.io}"
	TRACK_RECORD_NAMESPACE="${TRACK_RECORD_NAMESPACE:-chuggy}"
	export TRACK_RECORD_URL TRACK_RECORD_NAMESPACE
	if [ "${CHUG_CI_FULL:-0}" = "1" ]; then
		TRACK_RECORD_FRESH=1
		export TRACK_RECORD_FRESH
	fi
	if [ "${TRACK_RECORD_FRESH:-0}" = "1" ]; then
		echo "ci: every pass is recorded at $TRACK_RECORD_URL ($TRACK_RECORD_NAMESPACE), and none on record is reused"
	else
		echo "ci: a pass on record at $TRACK_RECORD_URL ($TRACK_RECORD_NAMESPACE) is reused"
	fi
fi

failed=0
errored=0
ran=0
reused=0
red=""

untracked_shown_max=20
untracked_count=0
untracked_unlisted=0
if ! untracked="$(git -c core.quotePath=false ls-files --others --exclude-standard)"; then
	echo "ci: LINTER ERROR — could not list the files git does not track; this is not a pass"
	untracked_unlisted=1
	untracked=""
fi
if [ -n "$untracked" ]; then
	untracked_count="$(printf '%s\n' "$untracked" | wc -l | tr -d ' ')"
	echo "ci: $untracked_count untracked file(s), which most gates do not read:"
	printf '%s\n' "$untracked" | head -n "$untracked_shown_max" | sed 's/^/ci:   /'
	if [ "$untracked_count" -gt "$untracked_shown_max" ]; then
		echo "ci:   and $((untracked_count - untracked_shown_max)) more"
	fi
	if [ "${CHUG_CI_ALLOW_UNTRACKED:-0}" = "1" ]; then
		echo "ci: CHUG_CI_ALLOW_UNTRACKED=1, so they do not fail the run"
	fi
fi

# Whether the run whose stderr is in the file was a pass on record: on one,
# the command never ran, and track-record's line saying so is the last there.
record_reused() { # <name> <stderr file>
	case "$(tail -n 1 "$2" 2>/dev/null)" in
	"track-record: REUSED $1 ("*) return 0 ;;
	esac
	return 1
}

# A word as the shell reads it back, for `eval`, printed or as $record_quoted,
# the second forking nothing for a word that holds no quote.
record_quote() { # <word>
	printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}
record_quote_into() { # <word>
	case "$1" in
	*\'*) record_quoted="$(record_quote "$1")" ;;
	*) record_quoted="'$1'" ;;
	esac
}

# What a gate's or a suite's key holds of the tree, the ignored files, the
# places its tools look and the install, as words for `eval`: the inputs
# `_ci-select.sh` declares for it, or the whole of each for one it declares
# keyed on the whole tree.
record_scope() { # <gate id or suite path>
	ci_inputs "$1"
	if [ "$CI_INPUTS_TREE" = 1 ]; then
		printf '%s ' --tool "$(record_quote "$record_tool_install")" \
			--tool "$(record_quote "$record_tool_ignored")"
		return 0
	fi
	record_specs=""
	record_packages=""
	record_probes=""
	set -f
	IFS='
'
	for record_word in $CI_INPUTS_TEXT$CI_INPUTS_CODE$CI_INPUTS_WITHIN; do
		record_quote_into "$record_word"
		record_specs="$record_specs $record_quoted"
	done
	for record_word in $CI_INPUTS_PACKAGES; do
		record_quote_into "$record_word"
		record_packages="$record_packages $record_quoted"
	done
	for record_word in $CI_INPUTS_PROBES; do
		record_quote_into "$record_word"
		record_probes="$record_probes $record_quoted"
	done
	if [ "$CI_INPUTS_INSTALL" = 1 ]; then
		printf '%s ' --tool "$(record_quote "$record_tool_install")"
	elif [ -n "$record_packages" ]; then
		printf '%s ' --tool "$(record_quote "$record_tool_installed$record_packages")"
	fi
	printf '%s ' --tool "$(record_quote "$record_tool_ignored$record_specs")"
	if [ -n "$record_probes" ]; then
		printf '%s ' --tool "$(record_quote "$record_tool_probed$record_probes")"
	fi
	for record_word in $CI_INPUTS_TEXT$CI_INPUTS_CODE; do
		record_quote_into "$record_word"
		printf '%s ' --inputs "$record_quoted"
	done
	unset IFS
	set +f
}

# What else a gate's verdict reads goes into its key, so a pass is reused only
# where the same question would be asked: the server a caller names or the
# image one is started from, since a server started by hand is not the one an
# evaluation gets; the corpus replayed; the walk's samples and seeds; the setup
# program the unit suites run; and the history the paths gate reads deleted
# paths from. Left out because none moves a verdict: the ports a server is
# published on, the caps on a wait or a walk (an overrun exits 2, never
# recorded), the cap on one test (it ends a test that never settles and is no
# bound on one that does, so a pass under a larger cap is a pass of the same
# tests), worker counts, colour, where a counterexample is written, and the
# CHUG_CI_* selection, which picks gates and asks none of them anything.
#
# Its stderr passes through as written and a copy is kept, from which
# `record_reused` reads; sets $rc and $record_hit.
record_gate() { # <gate-id> <script> [args...]
	record_name="$1"
	shift
	case "$record_name" in
	check-paths) set -- --tool 'git log --diff-filter=D --name-only --format=' -- "$@" ;;
	source-unit) set -- --env CHUG_SETUP_PROGRAM -- "$@" ;;
	check-conformance) set -- --env CHUG_GOLDEN_DIR -- "$@" ;;
	check-random)
		set -- --env CHUG_WALK_SAMPLES --env CHUG_WALK_SEED_BASE \
			--env CHUG_WALK_SEED --env CHUG_WALK_INSTANCE -- "$@"
		;;
	check-postgres | check-queries) set -- --env CHUG_PG_URL --env CHUG_PG_IMAGE -- "$@" ;;
	check-keto)
		set -- --env CHUG_KETO_READ_URL --env CHUG_KETO_WRITE_URL --env CHUG_KETO_IMAGE \
			--env CHUG_PG_URL --env CHUG_PG_IMAGE -- "$@"
		;;
	*) set -- -- "$@" ;;
	esac
	record_scoped="$(record_scope "$record_name")"
	eval "set -- $record_scoped --salt \"\$record_salt\" \"\$@\""
	rm -f "$record_dir/rc"
	{
		{
			track-record run --name "$record_name" --tool "$record_tool_node" \
				"$@" 2>&1 1>&3 3>&-
			echo "$?" >"$record_dir/rc"
		} | tee "$record_dir/err" >&2
	} 3>&1
	rc="$(cat "$record_dir/rc" 2>/dev/null || echo 2)"
	record_hit=0
	if record_reused "$record_name" "$record_dir/err"; then record_hit=1; fi
}

run_gate_itself() { # <gate-id> <script> [args...]
	# check-roster, doc-lint and check-agent-lag run themselves, as each reads
	# what no key holds for less than the gate costs to run: check-roster the
	# plugins installed on this machine, down to whether their files are there,
	# doc-lint whatever a relative link names on disk, a console's build output
	# included, and check-agent-lag what npm has released since.
	if [ -z "$record" ] || [ "$1" = "check-roster" ] || [ "$1" = "doc-lint" ] ||
		[ "$1" = "check-agent-lag" ]; then
		shift
		"$@"
		rc=$?
	else
		record_gate "$@"
	fi
}

# The end of a red gate's or suite's log, each line cut short, so a failure
# reads in a screen and a line of minified output cannot fill one.
show_log_tail() { # <log>
	echo "ci: the end of $1:"
	tail -n "$tail_lines" "$1" | cut -c 1-240 | sed 's/^/ci: | /'
}

# A red gate or suite as a line of the recap a quiet run ends on.
note_red() { # <label> <log>
	red="${red}ci:   $1 — $2
"
}

run_gate() { # <gate-id> <label> <script> [args...]
	gate_id="$1"
	label="$2"
	shift 2
	ran=$((ran + 1))
	printf '\n--- %s\n' "$label"
	if [ ! -x "$1" ]; then
		if [ -e "$1" ]; then why="is not executable"; else why="is missing"; fi
		echo "ci: LINTER ERROR — $1 $why; this is not a pass"
		errored=$((errored + 1))
		note_red "$label" "$1 $why"
		return 0
	fi
	gate_log="$log_dir/$gate_id.log"
	gate_started="$(date +%s)"
	set +e
	record_hit=0
	if [ "$quiet" = 1 ]; then
		run_gate_itself "$gate_id" "$@" >"$gate_log" 2>&1
	else
		run_gate_itself "$gate_id" "$@"
	fi
	set -e
	case "$rc" in
	0)
		reused=$((reused + record_hit))
		if [ "$quiet" = 1 ]; then
			if [ "$record_hit" = 1 ]; then how="reused"; else how="$(($(date +%s) - gate_started))s"; fi
			echo "ci: clean — $label ($how)"
		fi
		;;
	1)
		echo "ci: FAILED — $label"
		failed=$((failed + 1))
		;;
	*)
		echo "ci: LINTER ERROR ($rc) — $label could not run; this is not a pass"
		errored=$((errored + 1))
		;;
	esac
	if [ "$rc" != 0 ] && [ "$quiet" = 1 ]; then
		show_log_tail "$gate_log"
		note_red "$label" "$gate_log"
	fi
}

# THE UNIT STAGE KEYS EACH CLOSED SUITE ON ITS OWN AND RUNS WHAT IT MUST AT
# ONCE. Each entry is a closed suite, keyed on what `_ci-select.sh` declares
# of it, or every open suite together, keyed as the stage was keyed whole; an
# entry's command replays what one run of the runner found of its suites, and
# says it did not run where that run has not happened. So under a token each
# entry is asked once before the run, where a pass on record is reused and a
# miss records nothing, the suites of every miss run together in one runner,
# and each miss is asked again, now replaying its suites' outcome, which
# records the pass where they passed. Each round is so many entries at a time.
unit_entries_max=16

# Each entry's command, so many at a time, its status, output and stderr
# beside it.
unit_entries_run() { # <entry>...
	printf '%s\0' "$@" | xargs -0 -n 1 -P "$unit_entries_max" sh -c \
		'e="$1"; eval "set -- $(cat "$e.cmd")"; "$@" >"$e.out" 2>"$e.err"; echo "$?" >"$e.rc"' unit-entry
}

# An entry: its name, its suites, and its command, under `track-record run`
# with its key where there is a token.
unit_entry() { # <id> <suites, a path a line>
	unit_count=$((unit_count + 1))
	unit_entry="$unit_dir/$unit_count"
	printf '%s\n' "$1" >"$unit_entry.name"
	printf '%s\n' "$2" >"$unit_entry.suites"
	record_quote_into "$unit_script"
	unit_words="$record_quoted --unit-outcome"
	set -f
	for unit_suite in $2; do
		record_quote_into "$unit_suite"
		unit_words="$unit_words $record_quoted"
	done
	set +f
	if [ -n "$record" ]; then
		record_quote_into "$1"
		unit_words="track-record run --name $record_quoted --tool $(record_quote "$record_tool_node") \
			$(record_scope "$1") --salt $(record_quote "$record_salt") --env CHUG_SETUP_PROGRAM -- $unit_words"
	fi
	printf '%s\n' "$unit_words" >"$unit_entry.cmd"
	unit_entries="$unit_entries $unit_entry"
}

# The suites of a red entry by name, each with the end of its log, or the
# entry's own end where its suites all passed and it did not.
unit_red_show() { # <entry>
	unit_red_any=0
	set -f
	for unit_suite in $(cat "$1.suites"); do
		case "$(cat "$unit_results/$unit_suite.outcome" 2>/dev/null || true)" in
		pass) continue ;;
		fail) echo "ci: FAILED — $unit_suite" ;;
		*) echo "ci: LINTER ERROR — $unit_suite did not run; this is not a pass" ;;
		esac
		unit_red_any=1
		[ ! -f "$unit_results/$unit_suite.log" ] || show_log_tail "$unit_results/$unit_suite.log"
	done
	set +f
	if [ "$unit_red_any" = 0 ]; then
		echo "ci: LINTER ERROR — $(cat "$1.name") could not be replayed or recorded; this is not a pass"
		cat "$1.out" "$1.err" >"$1.log"
		show_log_tail "$1.log"
	fi
}

run_unit_stage() { # <label> <script> --unit
	label="$1"
	unit_script="$2"
	if [ -z "$only" ] && [ "$CI_SELECT_MODE" = changed ] && [ "$CI_SEQUENCER_CHANGED" != 1 ] &&
		[ -z "$CI_CHANGED_CODE" ] && ! ci_selected source-unit; then
		printf '\n--- %s: SKIPPED (no relevant changes)\n' "$label"
		return 0
	fi
	if ! ci_unit_partition; then
		shift
		if [ -n "$only" ] || ci_gate_selected source-unit; then
			run_gate source-unit "$label" "$@"
		else
			printf '\n--- %s: SKIPPED (no relevant changes)\n' "$label"
		fi
		return 0
	fi
	unit_every=0
	if [ -n "$only" ] || [ "$CI_SELECT_MODE" = full ] || [ "$CI_SEQUENCER_CHANGED" = 1 ]; then
		unit_every=1
	fi
	unit_open_count="$(printf '%s' "$CI_UNIT_OPEN" | grep -c '' || true)"
	unit_closed_count="$(printf '%s' "$CI_UNIT_CLOSED" | grep -c '' || true)"
	unit_dir="$log_dir/unit"
	unit_results="$unit_dir/results"
	rm -rf "$unit_dir"
	mkdir -p "$unit_results"
	unit_count=0
	unit_entries=""
	unit_selected=0
	if [ -n "$CI_UNIT_OPEN" ] && { [ "$unit_every" = 1 ] || ci_selected source-unit; }; then
		unit_entry source-unit "$CI_UNIT_OPEN"
		unit_selected="$unit_open_count"
	fi
	set -f
	for unit_suite in $CI_UNIT_CLOSED; do
		if [ "$unit_every" = 1 ] || ci_selected "source-unit:$unit_suite"; then
			unit_entry "source-unit:$unit_suite" "$unit_suite"
			unit_selected=$((unit_selected + 1))
		fi
	done
	set +f
	if [ -z "$unit_entries" ]; then
		printf '\n--- %s: SKIPPED (no relevant changes)\n' "$label"
		return 0
	fi
	ran=$((ran + 1))
	printf '\n--- %s\n' "$label"
	[ -z "$CI_UNIT_WHY" ] || echo "ci: every unit suite is open, as $CI_UNIT_WHY"
	gate_started="$(date +%s)"
	CHUG_UNIT_RESULTS="$unit_results"
	export CHUG_UNIT_RESULTS

	unit_pending="$unit_entries"
	unit_reused=0
	unit_reused_suites=0
	if [ -n "$record" ]; then
		# shellcheck disable=SC2086 # an entry a word, by construction
		unit_entries_run $unit_entries
		unit_pending=""
		for unit_entry in $unit_entries; do
			if [ "$(cat "$unit_entry.rc" 2>/dev/null)" = 0 ] &&
				record_reused "$(cat "$unit_entry.name")" "$unit_entry.err"; then
				unit_reused=$((unit_reused + 1))
				unit_reused_suites=$((unit_reused_suites + $(grep -c '' "$unit_entry.suites")))
			else
				unit_pending="$unit_pending $unit_entry"
			fi
		done
	fi

	unit_run_suites=""
	for unit_entry in $unit_pending; do
		unit_run_suites="$unit_run_suites$(cat "$unit_entry.suites")
"
	done
	unit_ran=0
	unit_rc=0
	if [ -n "$unit_run_suites" ]; then
		unit_ran="$(printf '%s' "$unit_run_suites" | grep -c '')"
		set -f
		# shellcheck disable=SC2086 # a suite a word, by construction
		set -- "$unit_script" --unit $unit_run_suites
		set +f
		set +e
		if [ "$quiet" = 1 ]; then
			"$@" >"$log_dir/source-unit.log" 2>&1
		else
			"$@"
		fi
		unit_rc=$?
		set -e
		# shellcheck disable=SC2086 # an entry a word, by construction
		unit_entries_run $unit_pending
	fi

	# The stage is a finding where the runner or an entry found one, and a
	# could-not-run where either could not run, which outranks a finding.
	unit_verdict=0
	unit_red=""
	for unit_rc_seen in "$unit_rc" $(for unit_entry in $unit_pending; do
		cat "$unit_entry.rc" 2>/dev/null || echo 2
	done); do
		case "$unit_rc_seen" in
		0) ;;
		1) [ "$unit_verdict" = 2 ] || unit_verdict=1 ;;
		*) unit_verdict=2 ;;
		esac
	done
	for unit_entry in $unit_pending; do
		[ "$(cat "$unit_entry.rc" 2>/dev/null)" = 0 ] || unit_red="$unit_red $unit_entry"
	done
	reused=$((reused + unit_reused))
	echo "ci: unit suites $unit_closed_count closed, $unit_open_count open; $unit_selected selected, $unit_reused_suites reused, $unit_ran ran"
	for unit_entry in $unit_red; do unit_red_show "$unit_entry"; done
	case "$unit_verdict" in
	0)
		[ "$quiet" != 1 ] || echo "ci: clean — $label ($(($(date +%s) - gate_started))s)"
		;;
	1)
		echo "ci: FAILED — $label"
		failed=$((failed + 1))
		;;
	*)
		echo "ci: LINTER ERROR — $label could not run; this is not a pass"
		errored=$((errored + 1))
		;;
	esac
	if [ "$unit_verdict" != 0 ]; then
		if [ -z "$unit_red" ] && [ -f "$log_dir/source-unit.log" ]; then show_log_tail "$log_dir/source-unit.log"; fi
		note_red "$label" "$log_dir/source-unit.log"
	fi
}

run_selected_gate() { # <gate-id> <label> <script> [args...]
	gate_id="$1"
	label="$2"
	shift 2
	if [ "$gate_id" = source-unit ]; then
		case "${only:- $gate_id }" in
		*" $gate_id "*) run_unit_stage "$label" "$@" ;;
		*) printf '\n--- %s: SKIPPED (not named by --only)\n' "$label" ;;
		esac
		return 0
	fi
	if [ -n "$only" ]; then
		case "$only" in
		*" $gate_id "*) run_gate "$gate_id" "$label" "$@" ;;
		*) printf '\n--- %s: SKIPPED (not named by --only)\n' "$label" ;;
		esac
	elif ! ci_gate_selected "$gate_id"; then
		printf '\n--- %s: SKIPPED (no relevant changes)\n' "$label"
	else
		run_gate "$gate_id" "$label" "$@"
	fi
}

run_selected_gate doc-lint "doc-lint" ./.chug/tasks/doc-lint.sh

run_selected_gate check-figures "check-figures" ./.chug/tasks/check-figures.sh
run_selected_gate check-paths "check-paths" ./.chug/tasks/check-paths.sh
run_selected_gate check-shell-quoting "check-shell-quoting" ./.chug/tasks/check-shell-quoting.sh
run_selected_gate check-duplication "check-duplication" ./.chug/tasks/check-duplication.sh
run_selected_gate check-console-sheets "check-console-sheets" ./.chug/tasks/check-console-sheets.sh
run_selected_gate check-gates "check-gates" ./.chug/tasks/check-gates.sh
run_selected_gate check-comments "check-comments" ./.chug/tasks/check-comments.sh
run_selected_gate check-roster "check-roster" ./.chug/tasks/check-roster.sh
run_selected_gate check-agent-lag "check-agent-lag" ./.chug/tasks/check-agent-lag.sh

if [ "${CHUG_CI_SHELL_SUITES:-1}" = "0" ]; then
	printf '\n--- shell suites: SKIPPED (CHUG_CI_SHELL_SUITES=0)\n'
elif [ -n "$only" ]; then
	printf '\n--- shell suites: SKIPPED (not named by --only)\n'
else
	printf '\n--- shell suites\n'
	suite_cap="${CHUG_CI_SUITE_TIMEOUT_SECS:-900}"

	# Probed functionally — `command -v` says a binary exists, not that it
	# runs. macOS ships no GNU `timeout`; `gtimeout` arrives with coreutils.
	# Its absence warns rather than errors: what the rule forbids is
	# announcing a bound that is not being applied, and the uncapped path says
	# exactly that.
	timeout_cmd=""
	if timeout 5 true >/dev/null 2>&1; then
		timeout_cmd="timeout"
	elif gtimeout 5 true >/dev/null 2>&1; then
		timeout_cmd="gtimeout"
	fi

	all_suites="$(git ls-files '*.test.sh' 2>/dev/null || true)"
	suites=""
	IFS='
'
	for suite in $all_suites; do
		if ci_suite_selected "$suite"; then
			suites="$suites$suite
"
		fi
	done
	unset IFS
	suites="$(printf '%s' "$suites" | sed '/^$/d')"
	if [ -z "$suites" ]; then
		if [ -z "$all_suites" ]; then
			echo "ci: LINTER ERROR — no *.test.sh found; the suite glob matched nothing"
			errored=$((errored + 1))
		else
			echo "ci: no shell suites selected"
		fi
	else
		if [ -n "$timeout_cmd" ]; then
			echo "ci: cap ${suite_cap}s per suite, no total"
		else
			echo "ci: WARNING — no working \`timeout\` or \`gtimeout\`, so suites run"
			echo "ci:           UNCAPPED. Install coreutils for the cap."
		fi
		# A suite's key takes the platform as well, since `sh` is not one
		# program everywhere. Its output goes to its own log, and its stderr
		# apart from that only when it is wrapped, where track-record's last
		# line there says whether it ran; the log takes a copy after.
		started="$(date +%s)"
		IFS='
'
		for suite in $suites; do
			printf '  - %s\n' "$suite"
			suite_log="$log_dir/suites/$(printf '%s' "$suite" | sed 's|^\.||' | tr '/ ' '__').log"
			suite_err="$suite_log.err"
			if [ -n "$record" ]; then suite_err="$record_dir/err"; fi
			if [ -n "$record" ]; then
				record_scoped="$(record_scope "$suite")"
				eval "set -- track-record run --name \"\$suite\" --tool \"\$record_tool_node\" \
					$record_scoped --salt \"\$record_salt\" --platform -- sh \"\$suite\""
			else
				set -- sh "$suite"
			fi
			set +e
			if [ -n "$timeout_cmd" ]; then
				CHUG_CI_SHELL_SUITES=0 "$timeout_cmd" "$suite_cap" "$@" >"$suite_log" 2>"$suite_err"
			else
				CHUG_CI_SHELL_SUITES=0 "$@" >"$suite_log" 2>"$suite_err"
			fi
			rc=$?
			set -e
			cat "$suite_err" >>"$suite_log"
			if [ -z "$record" ]; then rm -f "$suite_err"; fi
			if [ "$rc" -eq 124 ] && [ -n "$timeout_cmd" ]; then
				echo "ci: FAILED — $suite ran past the ${suite_cap}s cap (CHUG_CI_SUITE_TIMEOUT_SECS); rerun with: sh $suite"
				failed=$((failed + 1))
			elif [ "$rc" -ne 0 ]; then
				echo "ci: FAILED — $suite (rc=$rc); rerun with: sh $suite"
				failed=$((failed + 1))
			elif [ -n "$record" ] && record_reused "$suite" "$suite_err"; then
				printf '    %s\n' "$(tail -n 1 "$suite_err")"
				reused=$((reused + 1))
			fi
			if [ "$rc" -ne 0 ]; then
				show_log_tail "$suite_log"
				note_red "$suite" "$suite_log"
			fi
		done
		unset IFS
		echo "ci: suites finished in $(( $(date +%s) - started ))s"
	fi
fi

run_selected_gate check-boundaries "check-boundaries" ./.chug/tasks/check-boundaries.sh
run_selected_gate source-static "check-source static" ./.chug/tasks/check-source.sh --static
run_selected_gate source-unit "check-source unit" ./.chug/tasks/check-source.sh --unit
run_selected_gate check-console-copy "check-console-copy" ./.chug/tasks/check-console-copy.sh
run_selected_gate check-console "check-console" ./.chug/tasks/check-console.sh

run_selected_gate check-conformance "check-conformance" ./.chug/tasks/check-conformance.sh

run_selected_gate check-random "check-random" ./.chug/tasks/check-random.sh

run_selected_gate check-postgres "check-postgres" ./.chug/tasks/check-postgres.sh
run_selected_gate check-queries "check-queries" ./.chug/tasks/check-queries.sh
run_selected_gate check-keto "check-keto" ./.chug/tasks/check-keto.sh

run_selected_gate check-model "check-model" ./.chug/tasks/check-model.sh
run_selected_gate check-model-api "check-model-api" ./.chug/tasks/check-model-api.sh

printf '\n'
status=0
if [ "$errored" -gt 0 ]; then
	echo "ci: $errored gate(s) could not run, $failed failed"
	status=2
elif [ "$failed" -gt 0 ]; then
	echo "ci: $failed gate(s) failed"
	status=1
fi
if [ -n "$red" ] && [ "$quiet" = 1 ]; then
	echo "ci: red, with the log of each:"
	printf '%s' "$red"
fi
if [ "$untracked_count" -gt 0 ] && [ "${CHUG_CI_ALLOW_UNTRACKED:-0}" != "1" ]; then
	echo "ci: $untracked_count untracked file(s) went unchecked; git add them or ignore them"
	[ "$status" -ne 0 ] || status=1
fi
if [ "$untracked_unlisted" -eq 1 ]; then
	echo "ci: the files git does not track could not be listed; this is not a pass"
	status=2
fi
[ "$status" -eq 0 ] || exit "$status"
if [ "$ran" -eq 0 ]; then
	echo "ci: no gate selected; nothing ran"
	exit 0
fi
if [ -n "$only" ]; then
	clean="ci: only the gates named ran, and each was clean: $only_named"
else
	clean="ci: all gates clean"
fi
if [ -n "$record" ]; then
	echo "$clean ($reused reused)"
else
	echo "$clean"
fi
