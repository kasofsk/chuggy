# The unit suites, listed once for the gate that runs them and the sequencer
# that selects among them: `check-source.sh --unit` runs these, and `ci.sh`
# selects and keys each of them.
#
# Contract for a sourcing script (run from the root; the sourcing script sets
# its own shell options):
#   call      unit_suites_list
#   provides  $unit_suites   every tracked suite no other gate owns, a path a line
#             $unit_owned    every tracked suite another gate owns, a path a line
#   returns   1 where git lists no suite at all, and 2 where it cannot list
#
# The server-side arms mirror how those gates find their own work — the
# directory itself, not below it — so a suite nested deeper than they look is
# this stage's, which is what keeps the two halves a partition. The `ui/` arm
# is the whole subtree instead, because a console owns every file under its own
# directory and there is no depth at which one of its suites becomes this
# runner's.

unit_suites_list() {
	unit_suites=""
	unit_owned=""
	unit_tracked="$(git -c core.quotePath=false ls-files '*.test.ts' 2>/dev/null)" || return 2
	[ -n "$unit_tracked" ] || return 1
	unit_suites="$(printf '%s\n' "$unit_tracked" | grep -Ev "$unit_suites_owned" || true)"
	unit_owned="$(printf '%s\n' "$unit_tracked" | grep -E "$unit_suites_owned" || true)"
}
unit_suites_owned='^test/conformance/[^/]*\.test\.ts$|^test/random/[^/]*\.test\.ts$|^test/postgres/[^/]*\.test\.ts$|^test/keto/[^/]*\.test\.ts$|^ui/'
