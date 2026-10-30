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
# and a `track-record` that runs. Every gate but check-roster and doc-lint, and
# every suite, then runs under `track-record run`, keyed on what
# `.chug/tasks/_ci-select.sh` declares it reads: the tracked files its
# pathspecs match as they are on disk, the ignored files among them, what
# sits where its tools look for settings the tree need not hold, and npm's
# record of the packages it names, or of the whole install. A gate declared
# keyed on the whole tree is keyed on every tracked file, every ignored file
# in scope and the whole install. Every key also holds the version of node,
# what else that gate's verdict reads, and the salt below; none holds this
# script, the selection or the base it selects against. A key on record
# replays its log instead of running, and only an exit of 0 is recorded. A
# reused pass is a pass and nothing more: it is counted as one, and the clean
# line says how many there were. What no key sees, a reused pass does not
# check: a file a gate reads that its declaration does not name, a different
# server behind the same URL, a container reused by name, a file outside the
# tree or outside the scope `_ignored-inputs.sh` keys, such as a package
# changed under node_modules by hand, and git's own state: HEAD, the index and
# history, except where a gate keys them itself. With TRACK_RECORD_OFF=1, or
# without a token, a `track-record` that runs or a record directory, nothing is
# wrapped, every gate runs itself, and one line names the first reason why.
#
# ONE RUN AT A TIME HOLDS A CHECKOUT. A second is refused while the first is
# alive, since two would share the logs and each other's machine.
#
# A QUIET RUN PRINTS VERDICTS, NOT TRANSCRIPTS, for a reader whose every line
# costs it, such as an agent. Each gate's and each suite's output goes to its
# own log under the checkout's git directory, whose path the run prints first;
# the run prints one line per gate, the end of a red one's log under it, and
# the red ones again as its last lines, where a reader that keeps only the end
# of the output still finds them.
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

# The lock is a directory, since making one is atomic, and it names the run
# holding it. A holder no longer alive was killed past its trap, and its lock
# is taken over rather than left to refuse every run after it.
git_dir="$(git rev-parse --absolute-git-dir)" || exit 2
lock="$git_dir/chug-ci.lock"
log_dir="$git_dir/chug-ci"
if ! mkdir "$lock" 2>/dev/null; then
	holder="$(cat "$lock/pid" 2>/dev/null || true)"
	if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
		echo "ci: LINTER ERROR — another ci.sh (pid $holder) is running in this checkout, logging to $log_dir;"
		echo "ci: wait for it to end or stop it, then run again; this is not a pass"
		exit 2
	fi
	rm -rf "$lock"
	if ! mkdir "$lock" 2>/dev/null; then
		echo "ci: LINTER ERROR — could not take $lock; this is not a pass"
		exit 2
	fi
fi
echo "$$" >"$lock/pid"
record_dir=""
trap 'rm -rf "$lock" ${record_dir:+"$record_dir"}' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
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
record_salt="chuggy-ci-2"

# A key holds npm's own record of what it installed rather than the lock, since
# a lock that changed after `npm ci` names packages that are not the ones
# installed: the whole of it, or the packages a gate names with what each
# depends on, which `_installed-inputs.sh` prints. It holds the ignored files
# too, which `_ignored-inputs.sh` prints and says the scope of: every one a
# walk of the tree can reach, or those within a gate's pathspecs. And it holds
# what `_probed-inputs.sh` prints of the places a gate's tools look that the
# tree need not hold.
record_tool_node="node --version"
record_tool_install="cat node_modules/.package-lock.json"
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

# A word as the shell reads it back, for `eval`.
record_quote() { # <word>
	printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
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
	for record_word in $CI_INPUTS_TEXT$CI_INPUTS_CODE; do
		record_specs="$record_specs $(record_quote "$record_word")"
	done
	for record_word in $CI_INPUTS_PACKAGES; do
		record_packages="$record_packages $(record_quote "$record_word")"
	done
	for record_word in $CI_INPUTS_PROBES; do
		record_probes="$record_probes $(record_quote "$record_word")"
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
		printf '%s ' --inputs "$(record_quote "$record_word")"
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
	# check-roster and doc-lint run themselves, as each reads what no key holds
	# for less than the gate costs to run: check-roster the plugins installed
	# on this machine, down to whether their files are there, and doc-lint
	# whatever a relative link names on disk, a console's build output
	# included.
	if [ -z "$record" ] || [ "$1" = "check-roster" ] || [ "$1" = "doc-lint" ]; then
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

run_selected_gate() { # <gate-id> <label> <script> [args...]
	gate_id="$1"
	label="$2"
	shift 2
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
run_selected_gate check-knowledge "check-knowledge" ./.chug/tasks/check-knowledge.sh
run_selected_gate check-roster "check-roster" ./.chug/tasks/check-roster.sh
run_selected_gate check-vendored "check-vendored" ./.chug/tasks/check-vendored.sh

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
if [ -n "$record" ]; then
	echo "ci: all gates clean ($reused reused)"
else
	echo "ci: all gates clean"
fi
