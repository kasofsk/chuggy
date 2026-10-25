#!/bin/sh
# What a Track Record key holds of the files git ignores, printed for ci.sh's
# `--tool`: every ignored entry within the pathspecs it is given, or anywhere
# in the tree given none, by its name and by what it is. A gate keyed on its
# declared inputs is given those, so an ignored file outside them moves none
# of its keys; a gate keyed on the whole tree is given none, since its walk
# can reach any. A file is its content's hash; a symlink is its target, never
# followed; anything else is its name alone, such as a directory git did not
# descend into because it is another repository. No entry it lists makes it
# fail, since a tool that fails leaves every wrapped gate unrecorded.
#
# OUT OF SCOPE is what is written while a run is under way and is no gate's
# input: the root's and each workspace's node_modules, which npm's own record
# stands for in the key; a console's build output; and Claude Code's state
# under the root's `.claude`, whose worktrees git can list as entries that an
# exclude does not drop. An ignored entry anywhere else is in scope, a nested
# node_modules or a `dist` outside a console included, because tsc, eslint,
# node and depcruise walk directories.
#
# Usage: sh .chug/tasks/_ignored-inputs.sh [<pathspec>...]
# Run from the root. With `--entries` it describes the paths it is given.
set -eu
export LC_ALL=C

if [ "${1:-}" = "--entries" ]; then
	shift
	for path do
		shift
		case "$path" in .claude/*) continue ;; esac
		if [ -L "$path" ]; then
			printf '%s\0link\0%s\0' "$path" "$(readlink -- "$path")"
		elif [ -f "$path" ] && [ -r "$path" ]; then
			printf '%s\0file\0' "$path"
			set -- "$@" "$path"
		else
			printf '%s\0other\0' "$path"
		fi
	done
	# Each file's hash, in the order its name was printed.
	if [ "$#" -gt 0 ]; then git hash-object --no-filters -- "$@"; fi
	exit 0
fi

# The workspaces package.json declares, each of which npm may give its own
# node_modules.
workspaces="src/contract test/rig ui/chuggy-ui"
set -- "$@" ':(exclude)node_modules' ':(exclude).claude' ':(glob,exclude)ui/*/dist/**'
for workspace in $workspaces; do
	set -- "$@" ":(exclude)$workspace/node_modules"
done

# Listed whole before any is described, so a listing that fails fails here
# rather than reading as a tree with nothing ignored.
listing="$(mktemp)"
trap 'rm -f "$listing"' EXIT
git ls-files -z --others --ignored --exclude-standard -- "$@" >"$listing"
xargs -0 -n 100 sh "$0" --entries <"$listing"
