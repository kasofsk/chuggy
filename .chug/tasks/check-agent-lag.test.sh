#!/bin/sh
# Shell test for check-agent-lag.sh.
#
# npm is stubbed by an `npm` earlier on PATH than the real one, answering each
# `npm view` the gate makes from a fixture directory, so the cases fix what the
# registry holds. The version lists keep the registry's own shape: prereleases
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
shift
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
	(cd "$dir" && env PATH="$BIN:$PATH" "$@" "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

CLAUDE='["2.1.1","2.1.2","2.1.3","2.1.4","2.1.5","2.1.6","2.1.7","2.1.8","2.1.9","2.1.10"]'
CODEX='["0.1.0","0.2.0","0.2.0-linux-x64","0.3.0-alpha.1","0.3.0","0.3.0-linux-arm64"]'

fixture 2.1.5 0.2.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
stub_npm
run_in "$R"
check "pins within the cap are clean" 0 "$RC" "both within 5 releases"
check "the clean run says how far Claude Code is behind" 0 "$RC" "Claude Code 2.1.5 is 5 releases behind 2.1.10"
check "a prerelease and a platform build are not releases" 0 "$RC" "Codex 0.2.0 is 1 releases behind 0.3.0"

fixture 2.1.4 0.2.0
run_in "$R"
check "one release past the cap is a finding" 1 "$RC" "ERROR Claude Code 2.1.4 is 6 releases behind 2.1.10"
check "a Claude Code finding names its bump" 1 "$RC" "just bump-claude-code"

fixture 2.1.4 0.2.0
registry 2.1.9 "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R"
check "a Claude Code release past what the SDK names is not counted" 0 "$RC" "Claude Code 2.1.4 is 5 releases behind 2.1.9"

fixture 2.1.10 0.1.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R" CHUG_AGENT_LAG_MAX=1
check "a Codex finding names the version it is behind" 1 "$RC" "ERROR Codex 0.1.0 is 2 releases behind 0.3.0"
check "a Codex finding names the pin to move" 1 "$RC" "move ARG CODEX_VERSION in images/worker/Dockerfile"
refute "a pin that is current is no finding" 1 "$RC" "ERROR Claude Code"

fixture 2.1.10 0.1.0
registry 2.1.10 "$CLAUDE" 0.2.0 "$CODEX"
run_in "$R" CHUG_AGENT_LAG_MAX=0
check "a Codex release past npm's latest is not counted" 1 "$RC" "Codex 0.1.0 is 1 releases behind 0.2.0"

fixture 2.1.10 0.3.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R" CHUG_AGENT_LAG_MAX=0
check "pins at the newest pass a cap of none" 0 "$RC" "both within 0 releases"

fixture 2.1.12 0.3.0
run_in "$R" CHUG_AGENT_LAG_MAX=0
check "a pin ahead of what a bump reaches is no release behind" 0 "$RC" "Claude Code 2.1.12 is 0 releases behind 2.1.10"

fixture 2.1.5 0.2.0
run_in "$R" CHUG_AGENT_LAG_MAX=five
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
check "versions that are not a list could not run" 2 "$RC" "npm's releases of it are not versions"
refute "versions that are not a list are read, not crashed on" 2 "$RC" "TypeError"

fixture 2.1.5 0.2.0
registry "" "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R"
check "an SDK naming no Claude Code could not run" 2 "$RC" "Claude Code's pin 2.1.5 or npm's releases of it are not versions"

fixture 2.1.5-beta 0.2.0
registry 2.1.10 "$CLAUDE" 0.3.0 "$CODEX"
run_in "$R"
check "a pin that is not a release could not run" 2 "$RC" "Claude Code's pin 2.1.5-beta"

mkdir -p "$WORK/bare"
run_in "$WORK/bare"
check "outside a checkout could not run" 2 "$RC" "not a git checkout"

done_ check-agent-lag.test.sh
