#!/bin/sh
# The worker image's Claude Code and Codex pins are each no more than
# `CHUG_AGENT_LAG_RELEASES_MAX` releases behind the newest one their bump can
# reach.
#
# A configuration names its model by family, `--model=sonnet`, and a family is
# whichever model the pinned Claude Code takes it to mean, so a pin left behind
# runs an older model while nothing in the tree reads wrong.
#
# A RELEASE IS A STABLE VERSION NEWER THAN THE PIN, up to the newest a bump
# moves to: for Claude Code the one npm's latest Agent SDK names as its
# `claudeCodeVersion`, since `just bump-claude-code` moves the two together and
# can go no further, and for Codex npm's `latest`. A prerelease is not one, and
# neither is a platform build, whose version carries its platform as a suffix.
#
# A CHANGE UNDER `images/worker` SELECTS IT, where the pins are, as does a
# change to this script or to the sequencer, which selects every gate, and so
# does a full run. Other changes do not, so most tickets are not made to take on
# a bump outside their scope. Never reused: npm moves under a tree that does
# not.
#
# AN IMAGE BUILT FROM images/worker/Dockerfile RUNS IT ON ITS OWN TREE. The
# `agent-lag` stage does, and the runtime stage binds that stage's verdict, so a
# build of the runtime, or of the worker image built on it, refuses pins past
# the cap.
#
# Exits 0 clean, 1 when either is further behind, 2 when it could not run. Two
# is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-agent-lag: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

releases_max="${CHUG_AGENT_LAG_RELEASES_MAX:-5}"
case "$releases_max" in
*[!0-9]*)
	echo "check-agent-lag: LINTER ERROR — CHUG_AGENT_LAG_RELEASES_MAX is $releases_max, not a whole number"
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

# Each read is of the registry `just bump-claude-code` reads, whatever npm is
# set to, and each is bounded here rather than by npm's settings, so a registry
# that stalls ends as a could-not-run.
read_npm() { # <file> <npm view arguments...>
	file="$1"
	shift
	if ! npm view --registry=https://registry.npmjs.org/ --fetch-timeout=60000 --fetch-retries=2 "$@" >"$work/$file" 2>"$work/$file.err"; then
		echo "check-agent-lag: LINTER ERROR — npm view $* failed:"
		tail -n 3 "$work/$file.err" | sed 's/^/check-agent-lag: | /'
		exit 2
	fi
}
read_npm claude-ceiling @anthropic-ai/claude-agent-sdk@latest claudeCodeVersion
read_npm claude-versions @anthropic-ai/claude-code versions --json
read_npm codex-ceiling @openai/codex@latest version
read_npm codex-versions @openai/codex versions --json

# How many stable releases lie after the pin, up to and including the ceiling,
# and the ceiling; or, exiting 3, which input is not what it should be.
report_behind() { # <pin> <ceiling file> <versions file>
	node -e '
const fs = require("fs")
const [pin, ceilingFile, versionsFile] = process.argv.slice(1)
const refuse = (why) => { console.log(why); process.exit(3) }
const stable = /^\d+\.\d+\.\d+$/
const ceiling = fs.readFileSync(ceilingFile, "utf8").trim()
let versions
try { versions = JSON.parse(fs.readFileSync(versionsFile, "utf8")) } catch { refuse("npm'"'"'s list of its versions is not JSON") }
if (!stable.test(pin)) refuse("the pin " + pin + " is not a release")
if (!stable.test(ceiling)) refuse("npm names " + JSON.stringify(ceiling) + " as the newest a bump reaches, which is not a release")
if (!Array.isArray(versions)) refuse("npm'"'"'s list of its versions is not a list")
if (versions.some((v) => typeof v !== "string")) refuse("npm'"'"'s list of its versions holds something other than versions")
// The image installs the pin from npm and npm names the ceiling, so a list
// without either is not npm'"'"'s. A list missing what lies between them is not
// seen, since npm'"'"'s own skips versions.
const missing = [pin, ceiling].find((version) => !versions.includes(version))
if (missing !== undefined) refuse("npm'"'"'s list of its versions does not hold " + missing)
const order = (left, right) => {
  const [leftParts, rightParts] = [left, right].map((version) => version.split(".").map(Number))
  return leftParts[0] - rightParts[0] || leftParts[1] - rightParts[1] || leftParts[2] - rightParts[2]
}
const after = versions.filter((version) => stable.test(version) && order(version, pin) > 0 && order(version, ceiling) <= 0)
console.log(after.length + " " + ceiling)
' "$1" "$2" "$3"
}

findings=0
report() { # <name> <pin> <ceiling file> <versions file> <remedy>
	if ! result="$(report_behind "$2" "$work/$3" "$work/$4")"; then
		echo "check-agent-lag: LINTER ERROR — $1: ${result:-its releases could not be counted}"
		exit 2
	fi
	count="${result% *}"
	ceiling="${result#* }"
	if [ "$count" -gt "$releases_max" ]; then
		echo "ERROR $1 $2 is $count release(s) behind $ceiling: $5"
		findings=$((findings + 1))
	elif [ "$count" = 0 ]; then
		echo "check-agent-lag: $1 $2 is not behind $ceiling"
	else
		echo "check-agent-lag: $1 $2 is $count release(s) behind $ceiling"
	fi
}
report "Claude Code" "$claude_pin" claude-ceiling claude-versions \
	"run \`just bump-claude-code\`"
report "Codex" "$codex_pin" codex-ceiling codex-versions \
	"move ARG CODEX_VERSION in $dockerfile to it"

if [ "$findings" -gt 0 ]; then
	echo "check-agent-lag: FAILED — more than $releases_max release(s) behind (CHUG_AGENT_LAG_RELEASES_MAX); the rig runs the new one once the worker image and its runtime are built from it and admitted"
	exit 1
fi
echo "check-agent-lag: both within $releases_max release(s) (CHUG_AGENT_LAG_RELEASES_MAX)"
