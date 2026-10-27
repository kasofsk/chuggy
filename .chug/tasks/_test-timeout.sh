# The cap every test is run under, read the same way by every gate that runs
# node's test runner over suites holding sockets or servers.
#
# Contract for a sourcing gate (source as "$here/_test-timeout.sh" via a $here
# resolved from $0 before any cd; the sourcing gate sets its own shell options):
#   call      test_timeout_read <message prefix>
#   provides  $test_timeout_ms   what --test-timeout is handed
#   exits     2 through the caller's shell when the knob names no cap
#
# A TEST THAT NEVER SETTLES IS A FINDING, NOT A WAIT. node's runner gives a
# test no limit of its own, so a promise nothing resolves holds its gate with
# no end, and a gate that never answers enforces nothing. A gate hands this cap
# to `--test-timeout` beside `--test-force-exit`, so a test past it fails by
# name and its suite's process ends whatever handles the test left open.
#
# Env: CHUG_TEST_TIMEOUT_MS — the cap, a whole number of milliseconds. Zero
# would turn it off and is refused like any other value that is not a cap.

test_timeout_read() { # <message prefix>
	test_timeout_ms="${CHUG_TEST_TIMEOUT_MS:-60000}"
	case "$test_timeout_ms" in
	'' | *[!0-9]* | 0*)
		echo "$1: LINTER ERROR — CHUG_TEST_TIMEOUT_MS=$test_timeout_ms is not a whole number of milliseconds above zero, so no test can be capped"
		exit 2
		;;
	esac
}
