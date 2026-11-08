#!/bin/sh
# The worker image's Claude Code and Codex are each no more than
# `CHUG_AGENT_LAG_MAX` releases behind the newest one their bump can reach.
#
# A configuration names its model by family, `--model=sonnet`, and a family
# means what the pinned Claude Code takes it to mean: under 2.1.282 sonnet ran
# Sonnet 5 after Sonnet 5.5 had shipped, in every worker image built while that
# pin stood. Nothing in the tree read wrong, so only a reading of npm sees it.
#
# A RELEASE IS A STABLE VERSION NEWER THAN THE PIN, up to the newest a bump
# moves to: for Claude Code the one npm's latest Agent SDK names as its
# `claudeCodeVersion`, since `just bump-claude-code` moves the two together and
# can go no further, and for Codex npm's `latest`. A prerelease is not one, and
# neither is a platform build, whose version carries its platform as a suffix.
#
# SELECTED BY A CHANGE TO THE WORKER IMAGE, AND BY A FULL RUN. A change there is
# one an image is built from, so the bump goes out in the same build. A change
# anywhere else cannot move the image, and holding it to npm would turn every
# ticket red over what no ticket can fix. Never reused: npm moves under a tree
# that does not.
#
# Exits 0 clean, 1 when either is further behind, 2 when the pins or npm could
# not be read. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-agent-lag: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

max="${CHUG_AGENT_LAG_MAX:-5}"
case "$max" in
'' | *[!0-9]*)
	echo "check-agent-lag: LINTER ERROR — CHUG_AGENT_LAG_MAX is $max, not a whole number"
	exit 2
	;;
esac

dockerfile="images/worker/Dockerfile"
if [ ! -r "$dockerfile" ]; then
	echo "check-agent-lag: LINTER ERROR — cannot read $dockerfile"
	exit 2
fi

pin() { # <ARG name>
	if [ "$(grep -c "^ARG $1=" "$dockerfile")" != 1 ]; then
		echo "check-agent-lag: LINTER ERROR — $dockerfile sets ARG $1 other than once" >&2
		return 1
	fi
	sed -n "s/^ARG $1=//p" "$dockerfile"
}
claude_pin="$(pin CLAUDE_CODE_VERSION)" || exit 2
codex_pin="$(pin CODEX_VERSION)" || exit 2

if ! command -v npm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
	echo "check-agent-lag: LINTER ERROR — no npm or no node, so npm's releases cannot be read"
	exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Each read is npm's own, so a registry the user's npm is set to is the one read.
read_npm() { # <file> <npm view arguments...>
	file="$1"
	shift
	if ! npm view "$@" >"$work/$file" 2>"$work/$file.err"; then
		echo "check-agent-lag: LINTER ERROR — npm view $* failed:"
		tail -n 3 "$work/$file.err" | sed 's/^/check-agent-lag: | /'
		exit 2
	fi
}
read_npm claude-ceiling @anthropic-ai/claude-agent-sdk@latest claudeCodeVersion
read_npm claude-versions @anthropic-ai/claude-code versions --json
read_npm codex-ceiling @openai/codex@latest version
read_npm codex-versions @openai/codex versions --json

# How many stable releases lie after the pin, up to and including the ceiling.
behind() { # <pin> <ceiling file> <versions file>
	node -e '
const fs = require("fs")
const [pin, ceilingFile, versionsFile] = process.argv.slice(1)
const stable = /^\d+\.\d+\.\d+$/
const ceiling = fs.readFileSync(ceilingFile, "utf8").trim()
let versions
try { versions = JSON.parse(fs.readFileSync(versionsFile, "utf8")) } catch { versions = null }
if (!stable.test(pin) || !stable.test(ceiling) || !Array.isArray(versions)) process.exit(3)
const order = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number))
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}
const after = versions.filter(
  (v) => typeof v === "string" && stable.test(v) && order(v, pin) > 0 && order(v, ceiling) <= 0,
)
console.log(after.length + " " + ceiling)
' "$1" "$2" "$3"
}

findings=0
report() { # <name> <pin> <ceiling file> <versions file> <remedy>
	if ! result="$(behind "$2" "$work/$3" "$work/$4")"; then
		echo "check-agent-lag: LINTER ERROR — $1's pin $2 or npm's releases of it are not versions"
		exit 2
	fi
	count="${result% *}"
	ceiling="${result#* }"
	if [ "$count" -gt "$max" ]; then
		echo "ERROR $1 $2 is $count releases behind $ceiling: $5"
		findings=$((findings + 1))
	else
		echo "check-agent-lag: $1 $2 is $count releases behind $ceiling"
	fi
}
report "Claude Code" "$claude_pin" claude-ceiling claude-versions \
	"run \`just bump-claude-code\`"
report "Codex" "$codex_pin" codex-ceiling codex-versions \
	"move ARG CODEX_VERSION in $dockerfile to it"

if [ "$findings" -gt 0 ]; then
	echo "check-agent-lag: FAILED — more than $max releases behind (CHUG_AGENT_LAG_MAX); the rig runs the new one once the worker image is built from it and admitted"
	exit 1
fi
echo "check-agent-lag: both within $max releases (CHUG_AGENT_LAG_MAX)"
