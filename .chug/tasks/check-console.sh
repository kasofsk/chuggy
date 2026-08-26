#!/bin/sh
# A console that builds is typechecked, linted, tested and built from its own
# manifest, and the gate's verdict is those runs.
#
# WHICH CONSOLES. Every directory ONE SEGMENT under `ui/` carrying a tracked
# `package.json`, which is the console `no-console-sees-another` holds to its
# own directory and not any package installed or vendored inside one. That
# manifest is what makes a console a built one — it is
# where the build, the toolchain and the client dependencies are declared — and
# a console without one is files a browser fetches as they stand, which
# `check-boundaries.sh` is the whole of what can be said about. Until this tree
# holds a console that builds, the gate has nothing to run and says so.
#
# THE SCRIPT NAMES ARE THE CONTRACT: `typecheck`, `lint`, `test` and `build`,
# in that order, and a console that declares none of one of them is a finding
# rather than a skip. A gate that passed over a missing script would report a
# clean console having asked it nothing, and a build nothing typechecks is the
# thing this gate exists to refuse.
#
# WHY NOT `check-source.sh`. That gate holds this tree to one toolchain from
# the manifest at the root. A console that builds pins its own, so what runs
# over it has to be the console's own commands; the alternative is a verdict
# about a configuration nobody deploys.
#
# INSTALLED PACKAGES ARE A PRECONDITION, NOT A VERDICT. A console whose
# packages are not installed cannot be checked at all, so that is a
# could-not-run and the remedy is printed with the directory it belongs in. Two
# is not a pass.
#
# Usage:
#   .chug/tasks/check-console.sh
#
# Exits 0 clean, 1 on a finding, 2 when it could not run.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-console: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

if ! tracked="$(git ls-files 'ui/*/package.json')"; then
	echo "check-console: LINTER ERROR — could not list what is tracked under ui/"
	exit 2
fi

# Git's pathspec `*` crosses a separator, so that list holds a manifest at any
# depth. A console is one directory under `ui/` — the segment
# `no-console-sees-another` holds a console to — and a manifest below that
# belongs to a package inside a console rather than to a console of its own.
# Filtered by the shell rather than by a pattern matcher: a filter that is a
# command can be missing, and a missing one leaves the same empty list a tree
# with no built console leaves. A case glob crosses a separator too, so the
# deeper shape is excluded before the console shape is recognised.
manifests=""
set -f
IFS='
'
for candidate in $tracked; do
	case "$candidate" in
	ui/*/*/*) continue ;;
	ui/*/package.json)
		manifests="$manifests$candidate
"
		;;
	esac
done
unset IFS
set +f

if [ -z "$manifests" ]; then
	echo "check-console: no console under ui/ builds, so there is nothing to run"
	exit 0
fi

for tool in node npm; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "check-console: LINTER ERROR — no $tool, so no console can be built"
		exit 2
	fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Every declared script runs; the order is cheapest first so that a typecheck
# failure is on the reader's screen before the production build has been waited
# for.
required="typecheck lint test build"

# The declared subset in one call per console, because asking the manifest once
# per script name is the same read repeated. An unparseable manifest answers
# for itself rather than reading as a console declaring nothing.
declared_scripts() { # <manifest> <name>...
	node -e '
const fs = require("fs")
let manifest
try {
  manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
} catch {
  console.log("UNREADABLE")
  process.exit(0)
}
const scripts = (manifest && manifest.scripts) || {}
for (const name of process.argv.slice(2)) {
  if (typeof scripts[name] === "string" && scripts[name].trim() !== "") {
    console.log(name)
  }
}
' "$@" 2>/dev/null || echo UNREADABLE
}

set -f
IFS='
'
# shellcheck disable=SC2086 # one manifest per line by construction
set -- $manifests
unset IFS
set +f

findings=0
clean=0
consoles=0

for manifest in "$@"; do
	consoles=$((consoles + 1))
	dir="${manifest%/package.json}"
	if [ ! -d "$dir/node_modules" ]; then
		echo "check-console: LINTER ERROR — $dir has no installed packages"
		echo "check-console: install them with: npm ci --prefix $dir"
		exit 2
	fi
	# shellcheck disable=SC2086 # the required names are space-separated
	declared="$(declared_scripts "$manifest" $required)"
	case "$declared" in
	*UNREADABLE*)
		echo "ERROR $manifest: not readable as JSON, so no command can be taken from it"
		findings=$((findings + 1))
		continue
		;;
	esac
	for script in $required; do
		if ! printf '%s\n' "$declared" | grep -qx "$script"; then
			echo "ERROR $manifest: declares no \`$script\` script, so nothing runs one"
			findings=$((findings + 1))
			continue
		fi
		if (cd "$dir" && npm run --silent "$script") >"$work/out" 2>&1; then
			clean=$((clean + 1))
		else
			echo "ERROR $dir: \`npm run $script\` failed"
			sed 's/^/    /' "$work/out"
			findings=$((findings + 1))
		fi
	done
done

if [ "$findings" -gt 0 ]; then
	echo "check-console: $findings finding(s) across $consoles built console(s)"
	exit 1
fi
echo "check-console: $clean script(s) clean across $consoles built console(s)"
