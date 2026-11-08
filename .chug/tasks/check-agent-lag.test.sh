#!/bin/sh
# Shell test for check-agent-lag.sh.
#
# The registry is a node server of the suite's own, which
# `CHUG_AGENT_LAG_REGISTRY` points the gate at. It answers each path from a
# file in a fixture directory, so the cases fix what the registry holds; a path
# with no file answers 404, and while a `stall` file is there nothing is
# answered at all. The version lists keep the registry's own shape:
# prereleases and platform builds beside the stable releases, and releases past
# the newest a bump can reach.
#
# Run:  .chug/tasks/check-agent-lag.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-agent-lag.sh"

R="$WORK/repo"
NPM="$WORK/npm"
mkdir -p "$NPM"

node -e '
const http = require("http"), fs = require("fs"), path = require("path")
const [dir, portFile] = process.argv.slice(1)
http.createServer((request, response) => {
  if (fs.existsSync(path.join(dir, "stall"))) return
  fs.readFile(path.join(dir, encodeURIComponent(request.url)), (error, body) => {
    response.writeHead(error ? 404 : 200, { "content-type": "application/json" })
    response.end(error ? "" : body)
  })
}).listen(0, "127.0.0.1", function () {
  fs.writeFileSync(portFile + ".new", String(this.address().port))
  fs.renameSync(portFile + ".new", portFile)
})
' "$NPM" "$WORK/port" &
server=$!
trap 'kill "$server" 2>/dev/null; rm -rf "${WORK:?}"' EXIT
tries=0
while [ ! -s "$WORK/port" ]; do
	tries=$((tries + 1))
	if [ "$tries" -gt 100 ]; then
		echo "check-agent-lag.test.sh: the registry the suite serves did not start"
		exit 1
	fi
	sleep 0.1
done
REGISTRY="http://127.0.0.1:$(cat "$WORK/port")"

fixture() { # <claude pin> <codex pin>
	fresh_repo "$R"
	mkdir -p "$R/images/worker"
	printf 'FROM base AS runtime\nARG CLAUDE_CODE_VERSION=%s\nARG CODEX_VERSION=%s\nARG AGENT_SDK_VERSION=0.3.1\n' \
		"$1" "$2" >"$R/images/worker/Dockerfile"
}

answer() { # <path> <body>
	printf '%s\n' "$2" >"$NPM/$(printf '%s' "$1" | sed 's|/|%2F|g; s|@|%40|g')"
}

# A package's record as npm keeps it, from a list of its versions; anything but
# a list is the record's whole body.
record() { # <versions json, or a body>
	node -e '
let versions
try { versions = JSON.parse(process.argv[1]) } catch { versions = undefined }
process.stdout.write(Array.isArray(versions)
  ? JSON.stringify({ versions: Object.fromEntries(versions.map((version) => [version, {}])) })
  : process.argv[1])
' "$1"
}

# The registry: the Claude Code the newest SDK names, Claude Code's versions,
# Codex's latest and Codex's versions.
registry() { # <sdk's claude code> <claude versions json> <codex latest> <codex versions json>
	rm -f "${NPM:?}"/*
	answer /@anthropic-ai/claude-agent-sdk/latest "{\"version\":\"0.3.1\",\"claudeCodeVersion\":\"$1\"}"
	answer /@anthropic-ai/claude-code "$(record "$2")"
	answer /@openai/codex/latest "{\"version\":\"$3\"}"
	answer /@openai/codex "$(record "$4")"
}

run_in() { # <dir> [VAR=value...]
	dir="$1"
	shift
	OUT="$WORK/.out"
	set +e
	(cd "$dir" && env CHUG_AGENT_LAG_REGISTRY="$REGISTRY" "$@" "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

CLAUDE='["2.1.1","2.1.2","2.1.3","2.1.4","2.1.5","2.1.6","2.1.7","2.1.8","2.1.9","2.1.10","2.1.11","2.1.12"]'
CODEX='["0.1.0","0.2.0","0.2.0-linux-x64","0.3.0-alpha.1","0.3.0","0.3.0-linux-arm64"]'

fixture 2.1.5 0.2.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R"
check "pins within the cap are clean" 0 "$RC" "both within 5 release(s)"
check "the clean run says how far Claude Code is behind" 0 "$RC" "Claude Code 2.1.5 is 5 release(s) behind 2.1.10"
check "a release between pin and ceiling is counted" 0 "$RC" "Codex 0.2.0 is 1 release(s) behind 0.3.0"

fixture 2.1.10 0.2.0
registry 2.1.10 "$CLAUDE" 0.4.0 '["0.2.0","0.3.0-alpha.1","0.3.0-linux-x64","0.3.0","0.4.0"]'
run_in "$R"
check "a prerelease and a platform build are not releases" 0 "$RC" "Codex 0.2.0 is 2 release(s) behind 0.4.0"
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"

fixture 2.1.4 0.2.0
run_in "$R"
check "one release past the cap is a finding" 1 "$RC" "ERROR Claude Code 2.1.4 is 6 release(s) behind 2.1.10"
check "a Claude Code finding names its bump" 1 "$RC" "just bump-claude-code"

fixture 2.1.4 0.2.0
registry 2.1.9 "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R"
check "a Claude Code release past what the SDK names is not counted" 0 "$RC" "Claude Code 2.1.4 is 5 release(s) behind 2.1.9"

fixture 2.1.10 0.1.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R" CHUG_AGENT_LAG_RELEASES_MAX=1
check "a Codex finding names the version it is behind" 1 "$RC" "ERROR Codex 0.1.0 is 2 release(s) behind 0.3.0"
check "a Codex finding names the pin to move" 1 "$RC" "move ARG CODEX_VERSION in images/worker/Dockerfile"
refute "a pin that is current is no finding" 1 "$RC" "ERROR Claude Code"

fixture 2.1.10 0.1.0
registry 2.1.10 "$CLAUDE" 0.2.0 "$CODEX"
run_in "$R" CHUG_AGENT_LAG_RELEASES_MAX=0
check "a Codex release past npm's latest is not counted" 1 "$RC" "Codex 0.1.0 is 1 release(s) behind 0.2.0"

fixture 2.1.10 0.3.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R" CHUG_AGENT_LAG_RELEASES_MAX=0
check "pins at the newest pass a cap of none" 0 "$RC" "both within 0 release(s)"

fixture 2.1.12 0.3.0
run_in "$R" CHUG_AGENT_LAG_RELEASES_MAX=0
check "a pin ahead of what a bump reaches is not behind" 0 "$RC" "Claude Code 2.1.12 is not behind 2.1.10"

fixture 2.1.10 0.9.0
registry 2.1.10 "$CLAUDE" 1.0.1 '["0.9.0","0.10.0","1.0.0","1.0.1"]'
run_in "$R"
check "a release of a later major or minor is counted" 0 "$RC" "Codex 0.9.0 is 3 release(s) behind 1.0.1"

fixture 2.1.5 0.2.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
printf '# ARG CODEX_VERSION=0.0.1 is how a pin reads\n' >>"$R/images/worker/Dockerfile"
run_in "$R"
check "a pin is read only where it is set" 0 "$RC" "Codex 0.2.0 is 1 release(s) behind 0.3.0"

fixture 2.1.5 0.2.0
mkdir -p "$R/images/worker/deep"
run_in "$R/images/worker/deep"
check "a run from below the root reads the root's pins" 0 "$RC" "Claude Code 2.1.5 is 5 release(s) behind 2.1.10"

fixture 2.1.5 0.2.0
run_in "$R" CHUG_AGENT_LAG_RELEASES_MAX=five
check "a cap that is not a whole number could not run" 2 "$RC" "CHUG_AGENT_LAG_RELEASES_MAX is five, not a whole number"
run_in "$R" CHUG_AGENT_LAG_TIMEOUT_SECONDS=soon
check "a bound that is not a whole number could not run" 2 "$RC" "CHUG_AGENT_LAG_TIMEOUT_SECONDS is soon, not a whole number"

fixture 2.1.5 0.2.0
printf 'ARG CODEX_VERSION=0.2.0\n' >>"$R/images/worker/Dockerfile"
run_in "$R"
check "a pin set twice could not run" 2 "$RC" "sets ARG CODEX_VERSION other than once"

fixture 2.1.5 0.2.0
sed -i.bak '/^ARG CLAUDE_CODE_VERSION=/d' "$R/images/worker/Dockerfile"
run_in "$R"
check "a missing pin could not run" 2 "$RC" "sets ARG CLAUDE_CODE_VERSION other than once"

fixture 2.1.5 0.2.0
rm "$R/images/worker/Dockerfile"
run_in "$R"
check "no Dockerfile could not run" 2 "$RC" "cannot read images/worker/Dockerfile"

fixture 2.1.5 0.2.0
rm "$NPM/%2F%40openai%2Fcodex"
run_in "$R"
check "a read the registry refuses could not run, and says what it answered" 2 "$RC" "Codex: $REGISTRY/@openai/codex answered 404"
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"

touch "$NPM/stall"
run_in "$R" CHUG_AGENT_LAG_TIMEOUT_SECONDS=1
check "a registry that stalls could not run once the bound is spent" 2 "$RC" "/@anthropic-ai/claude-agent-sdk/latest could not be read: TimeoutError"
rm "$NPM/stall"

run_in "$R" CHUG_AGENT_LAG_REGISTRY= CHUG_AGENT_LAG_TIMEOUT_SECONDS=0
check "the registry read when none is named is npm's own" 2 "$RC" "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest could not be read: TimeoutError"

run_in "$R" CHUG_AGENT_LAG_REGISTRY=http://registry.invalid
check "a registry that cannot be reached could not run" 2 "$RC" "http://registry.invalid/@anthropic-ai/claude-agent-sdk/latest could not be read: "

fixture 2.1.5 0.2.0
registry 2.1.10 'not json' 0.3.0 "$CODEX"
run_in "$R"
check "a record that is not JSON could not run, and says so" 2 "$RC" "Claude Code: $REGISTRY/@anthropic-ai/claude-code is not JSON"
refute "a record that is not JSON is read, not crashed on" 2 "$RC" "SyntaxError"

for body in '{"error":"not found"}' '{"versions":null}' '{"versions":["2.1.5","2.1.10"]}'; do
	fixture 2.1.5 0.2.0
	registry 2.1.10 "$body" 0.3.0 "$CODEX"
	run_in "$R"
	check "a record of $body could not run, and says so" 2 "$RC" "Claude Code: npm's record of it lists no versions"
	refute "a record of $body is read, not crashed on" 2 "$RC" "TypeError"
done

for case in '[]|2.1.5' '["2.1.9","2.1.10"]|2.1.5' '["2.1.1","2.1.5","2.1.9"]|2.1.10'; do
	fixture 2.1.5 0.2.0
	registry 2.1.10 "${case%|*}" 0.3.0 "$CODEX"
	run_in "$R"
	check "a list of ${case%|*}, without ${case#*|}, could not run" 2 "$RC" "Claude Code: npm's list of its versions does not hold ${case#*|}"
done

fixture 2.1.5 0.2.0
registry "" "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R"
check "an SDK naming no Claude Code could not run, and say so" 2 "$RC" 'npm names "" as the newest a bump reaches'
answer /@anthropic-ai/claude-agent-sdk/latest '{"claudeCodeVersion":["2.1.10"]}'
run_in "$R"
check "an SDK naming what is not a version could not run, and say so" 2 "$RC" 'npm names ["2.1.10"] as the newest a bump reaches'
answer /@anthropic-ai/claude-agent-sdk/latest '{"version":"0.3.1"}'
run_in "$R"
check "an SDK naming nothing could not run, and say so" 2 "$RC" "npm names null as the newest a bump reaches"

fixture 2.1.5-beta 0.2.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R"
check "a pin that is not a release could not run, and say so" 2 "$RC" "Claude Code: the pin 2.1.5-beta is not a release"

# A PATH holding only the tools named, each the one this shell finds, so a case
# can leave out node and keep what the gate needs before it asks for it.
mkdir -p "$WORK/tools"
for tool in git grep sed; do ln -s "$(command -v "$tool")" "$WORK/tools/$tool"; done
fixture 2.1.5 0.2.0
OUT="$WORK/.out"
set +e
(cd "$R" && env PATH="$WORK/tools" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "no node could not run" 2 "$RC" "no node, so the registry cannot be read"

mkdir -p "$WORK/bare"
run_in "$WORK/bare"
check "outside a checkout could not run" 2 "$RC" "not a git checkout"

done_ check-agent-lag.test.sh
