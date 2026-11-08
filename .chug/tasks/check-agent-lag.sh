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
# THE REGISTRY IS READ AS THE BUMP READS IT: registry.npmjs.org, through node's
# own `fetch`, so no npm setting or cache stands between the two. Each read is
# bounded, and one that fails, stalls or answers what npm would not ends as a
# could-not-run. `CHUG_AGENT_LAG_REGISTRY` names another registry, and
# `CHUG_AGENT_LAG_TIMEOUT_SECONDS` another bound.
#
# A CHANGE UNDER `images/worker` SELECTS IT, where the pins are, as does a
# change to this script or to the sequencer, which selects every gate, and so
# does a full run. Other changes do not, so most tickets are not made to take on
# a bump outside their scope. Never reused: npm moves under a tree that does
# not.
#
# THE RUNTIME IMAGE, AND THE WORKER IMAGE BUILT ON IT, ARE HELD TO IT. The
# `agent-lag` stage of images/worker/Dockerfile runs it on the pins that file
# sets, and the runtime stage binds that stage's verdict, so a build of either
# refuses them past the cap, but for the cached verdict that stage describes. A
# pin a build overrides with `--build-arg` is not read.
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

whole_number() { # <variable> <value>
	case "$2" in
	*[!0-9]*)
		echo "check-agent-lag: LINTER ERROR — $1 is $2, not a whole number"
		return 1
		;;
	esac
}
releases_max="${CHUG_AGENT_LAG_RELEASES_MAX:-5}"
whole_number CHUG_AGENT_LAG_RELEASES_MAX "$releases_max" || exit 2
timeout_seconds="${CHUG_AGENT_LAG_TIMEOUT_SECONDS:-60}"
whole_number CHUG_AGENT_LAG_TIMEOUT_SECONDS "$timeout_seconds" || exit 2
registry="${CHUG_AGENT_LAG_REGISTRY:-https://registry.npmjs.org}"

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

if ! command -v node >/dev/null 2>&1; then
	echo "check-agent-lag: LINTER ERROR — no node, so the registry cannot be read"
	exit 2
fi

# How many stable releases lie after the pin, up to and including the ceiling,
# and the ceiling, read off the registry; or, exiting 3, which read or which
# input is not what it should be.
report_behind() { # <pin> <ceiling's document> <ceiling's field> <package's document>
	node --input-type=module -e '
const [pin, registry, timeoutSeconds, ceilingPath, ceilingField, packagePath] = process.argv.slice(1)
const refuse = (why) => { console.log(why); process.exit(3) }
const stable = /^\d+\.\d+\.\d+$/
if (!stable.test(pin)) refuse("the pin " + pin + " is not a release")
const read = async (path, accept) => {
  const url = registry + path
  try {
    const response = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(timeoutSeconds * 1000) })
    if (!response.ok) refuse(url + " answered " + response.status)
    return JSON.parse(await response.text())
  } catch (error) {
    refuse(url + (error instanceof SyntaxError ? " is not JSON" : " could not be read: " + (error.cause?.code ?? error.cause?.message ?? error.name)))
  }
}
const ceiling = (await read(ceilingPath, "application/json"))?.[ceilingField]
if (typeof ceiling !== "string" || !stable.test(ceiling)) refuse("npm names " + JSON.stringify(ceiling ?? null) + " as the newest a bump reaches, which is not a release")
const versions = (await read(packagePath, "application/vnd.npm.install-v1+json"))?.versions
if (versions === null || typeof versions !== "object" || Array.isArray(versions)) refuse("npm'"'"'s record of it lists no versions")
const released = Object.keys(versions)
// The pin and the ceiling are each a version npm published, so a list
// without either is not npm'"'"'s. A list missing what lies between them is not
// seen, since npm'"'"'s own skips versions.
const missing = [pin, ceiling].find((version) => !released.includes(version))
if (missing !== undefined) refuse("npm'"'"'s list of its versions does not hold " + missing)
const order = (left, right) => {
  const [leftParts, rightParts] = [left, right].map((version) => version.split(".").map(Number))
  return leftParts[0] - rightParts[0] || leftParts[1] - rightParts[1] || leftParts[2] - rightParts[2]
}
const after = released.filter((version) => stable.test(version) && order(version, pin) > 0 && order(version, ceiling) <= 0)
console.log(after.length + " " + ceiling)
' "$1" "$registry" "$timeout_seconds" "$2" "$3" "$4"
}

findings=0
report() { # <name> <pin> <ceiling's document> <ceiling's field> <package's document> <remedy>
	if ! result="$(report_behind "$2" "$3" "$4" "$5")"; then
		echo "check-agent-lag: LINTER ERROR — $1: ${result:-its releases could not be counted}"
		exit 2
	fi
	count="${result% *}"
	ceiling="${result#* }"
	case "$count" in
	'' | *[!0-9]*) unread=1 ;;
	*) unread=0 ;;
	esac
	case "$ceiling" in
	'' | *[!0-9.]*) unread=1 ;;
	esac
	if [ "$unread" = 1 ]; then
		echo "check-agent-lag: LINTER ERROR — $1: counted '$result', not a count and a version"
		exit 2
	fi
	if [ "$count" -gt "$releases_max" ]; then
		echo "ERROR $1 $2 is $count release(s) behind $ceiling: $6"
		findings=$((findings + 1))
	elif [ "$count" = 0 ]; then
		echo "check-agent-lag: $1 $2 is not behind $ceiling"
	else
		echo "check-agent-lag: $1 $2 is $count release(s) behind $ceiling"
	fi
}
report "Claude Code" "$claude_pin" /@anthropic-ai/claude-agent-sdk/latest claudeCodeVersion \
	/@anthropic-ai/claude-code "run \`just bump-claude-code\`"
report "Codex" "$codex_pin" /@openai/codex/latest version \
	/@openai/codex "move ARG CODEX_VERSION in $dockerfile to it"

if [ "$findings" -gt 0 ]; then
	echo "check-agent-lag: FAILED — more than $releases_max release(s) behind (CHUG_AGENT_LAG_RELEASES_MAX); the rig runs the new one once the worker image and its runtime are built from it and admitted"
	exit 1
fi
echo "check-agent-lag: both within $releases_max release(s) (CHUG_AGENT_LAG_RELEASES_MAX)"
