#!/bin/sh
# What a Track Record key holds of the places a gate's tools look for a file
# the tree need not hold, printed for ci.sh's `--tool`: every file at or below
# each path given, tracked, untracked or ignored, described as
# `.chug/tasks/_ignored-inputs.sh --entries` describes one. A path that holds
# none prints nothing, so a file arriving there moves the key; a pathspec
# naming it would match no tracked file, which Track Record refuses.
#
# Usage: sh .chug/tasks/_probed-inputs.sh <pathspec>...
# Run from the root.
set -eu
export LC_ALL=C

if [ "$#" -eq 0 ]; then
	echo "_probed-inputs: name a path" >&2
	exit 2
fi

# Listed whole before any is described, so a listing that fails fails here
# rather than reading as places that hold nothing.
listing="$(mktemp)"
trap 'rm -f "$listing"' EXIT
git ls-files -z --cached --others -- "$@" >"$listing"
xargs -0 -n 100 sh .chug/tasks/_ignored-inputs.sh --entries <"$listing"
