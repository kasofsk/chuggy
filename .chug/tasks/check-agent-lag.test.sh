#!/bin/sh
# Shell test for check-agent-lag.sh.
#
# npm is stubbed by an `npm` earlier on PATH than the real one, answering each
# `npm view` the gate makes from a fixture directory, so the cases fix what the
# registry holds. The gate runs with a TMPDIR of the suite's, so the stub can
# hold each read to a cache under the run's own directory. The version lists keep the registry's own shape: prereleases
# and platform builds beside the stable releases, and releases past the newest
# a bump can reach.
#
# Run:  .chug/tasks/check-agent-lag.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-agent-lag.sh"

R="$WORK/repo"
BIN="$WORK/bin"
NPM="$WORK/npm"

fixture() { # <claude pin> <codex pin>
	fresh_repo "$R"
	mkdir -p "$R/images/worker"
	printf 'FROM base AS runtime\nARG CLAUDE_CODE_VERSION=%s\nARG CODEX_VERSION=%s\nARG AGENT_SDK_VERSION=0.3.1\n' \
		"$1" "$2" >"$R/images/worker/Dockerfile"
}

# The registry: the Claude Code the newest SDK names, Claude Code's versions,
# Codex's latest and Codex's versions.
registry() { # <sdk's claude code> <claude versions json> <codex latest> <codex versions json>
	rm -rf "$NPM"
	mkdir -p "$NPM"
	printf '%s\n' "$1" >"$NPM/sdk-claude"
	printf '%s\n' "$2" >"$NPM/claude-versions"
	printf '%s\n' "$3" >"$NPM/codex-latest"
	printf '%s\n' "$4" >"$NPM/codex-versions"
}

stub_npm() { # [failing view]
	rm -rf "$BIN"
	mkdir -p "$BIN"
	cat >"$BIN/npm" <<EOF
#!/bin/sh
[ "\$1" = view ] || exit 127
case "\$2 \$3 \$4 \$5 \$6" in
"--registry=https://registry.npmjs.org/ --cache=$WORK/tmp/"*"/npm --logs-max=0 --fetch-timeout=60000 --fetch-retries=2") shift 6 ;;
*) echo "an npm view of another registry or cache, or with no bound of its own" >&2; exit 1 ;;
esac
if [ "\$*" = "${1:-none}" ]; then echo "npm error code E404" >&2; exit 1; fi
case "\$*" in
"@anthropic-ai/claude-agent-sdk@latest claudeCodeVersion") cat "$NPM/sdk-claude" ;;
"@anthropic-ai/claude-code versions --json") cat "$NPM/claude-versions" ;;
"@openai/codex@latest version") cat "$NPM/codex-latest" ;;
"@openai/codex versions --json") cat "$NPM/codex-versions" ;;
*) echo "unexpected npm view \$*" >&2; exit 1 ;;
esac
EOF
	chmod +x "$BIN/npm"
}

run_in() { # <dir> [VAR=value...]
	dir="$1"
	shift
	OUT="$WORK/.out"
	set +e
	mkdir -p "$WORK/tmp"
	(cd "$dir" && env PATH="$BIN:$PATH" TMPDIR="$WORK/tmp" "$@" "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

CLAUDE='["2.1.1","2.1.2","2.1.3","2.1.4","2.1.5","2.1.6","2.1.7","2.1.8","2.1.9","2.1.10","2.1.11","2.1.12"]'
CODEX='["0.1.0","0.2.0","0.2.0-linux-x64","0.3.0-alpha.1","0.3.0","0.3.0-linux-arm64"]'

fixture 2.1.5 0.2.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
stub_npm
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
check "a cap that is not a whole number could not run" 2 "$RC" "not a whole number"

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
stub_npm "@openai/codex versions --json"
run_in "$R"
check "a registry read that fails could not run" 2 "$RC" "npm view @openai/codex versions --json failed"
check "the failed read says why" 2 "$RC" "E404"
stub_npm

fixture 2.1.5 0.2.0
registry 2.1.10 '{"error":"not a list"}' 0.3.0 "$CODEX"
run_in "$R"
check "versions that are not a list could not run, and say so" 2 "$RC" "Claude Code: npm's list of its versions is not a list"
refute "versions that are not a list are read, not crashed on" 2 "$RC" "TypeError"

for case in '[]|2.1.5' '["2.1.9","2.1.10"]|2.1.5' '["2.1.1","2.1.5","2.1.9"]|2.1.10'; do
	fixture 2.1.5 0.2.0
	registry 2.1.10 "${case%|*}" 0.3.0 "$CODEX"
	run_in "$R"
	check "a list of ${case%|*}, without ${case#*|}, could not run" 2 "$RC" "Claude Code: npm's list of its versions does not hold ${case#*|}"
done

fixture 2.1.5 0.2.0
registry 2.1.10 "$CLAUDE" 0.3.0 '[{"version":"0.3.0"},"0.3.0"]'
run_in "$R"
check "a list holding what is not a version could not run" 2 "$RC" "Codex: npm's list of its versions holds something other than versions"

fixture 2.1.5 0.2.0
registry 2.1.10 'not json' 0.3.0 "$CODEX"
run_in "$R"
check "versions that are not JSON could not run, and say so" 2 "$RC" "Claude Code: npm's list of its versions is not JSON"
refute "versions that are not JSON are read, not crashed on" 2 "$RC" "SyntaxError"

fixture 2.1.5 0.2.0
registry "" "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R"
check "an SDK naming no Claude Code could not run, and say so" 2 "$RC" 'npm names "" as the newest a bump reaches'

fixture 2.1.5-beta 0.2.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R"
check "a pin that is not a release could not run, and say so" 2 "$RC" "Claude Code: the pin 2.1.5-beta is not a release"

# A PATH holding only the tools named, each the one this shell finds, so a case
# can leave out npm or node and keep what the gate needs before it asks for them.
only_tools() { # <tool>...
	rm -rf "$WORK/tools"
	mkdir -p "$WORK/tools"
	for tool in "$@"; do ln -s "$(command -v "$tool")" "$WORK/tools/$tool"; done
}
run_only_tools() {
	OUT="$WORK/.out"
	set +e
	(cd "$R" && env PATH="$WORK/tools" "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}
fixture 2.1.5 0.2.0
only_tools git grep sed node
run_only_tools
check "no npm could not run" 2 "$RC" "no npm or no node"
PATH="$BIN:$PATH" only_tools git grep sed npm
run_only_tools
check "no node could not run" 2 "$RC" "no npm or no node"

mkdir -p "$WORK/bare"
run_in "$WORK/bare"
check "outside a checkout could not run" 2 "$RC" "not a git checkout"

done_ check-agent-lag.test.sh
