#!/bin/sh
# Shell test for check-roster.sh.
#
# The installed set is stubbed by a `claude` earlier on PATH than the real one,
# which also proves the gate asks the CLI rather than the cache behind it.
#
# Its shape is taken from the real command: a row per scope, so one name arrives
# twice, and rows whose `projectPath` is another checkout. A stub emitting one
# row per name leaves the dimension the gate has to get right untested.
#
# Run:  .chug/tasks/check-roster.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-roster.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"
BIN="$WORK/bin"

fixture() { # <settings json>
	rm -rf "$R"
	mkdir -p "$R/.claude"
	printf '%s\n' "$1" > "$R/.claude/settings.json"
	git -C "$R" init -q -b main
	git -C "$R" config user.email t@example.com
	git -C "$R" config user.name t
}

stub_claude() { # <exit code> <json>
	rm -rf "$BIN"
	mkdir -p "$BIN"
	{
		printf '#!/bin/sh\n'
		printf 'if [ "$1" = plugin ] && [ "$2" = list ]; then\n'
		printf '\tcat <<%s\n%s\n%s\n' "STUB_JSON" "$2" "STUB_JSON"
		printf '\texit %s\n' "$1"
		printf 'fi\nexit 127\n'
	} > "$BIN/claude"
	chmod +x "$BIN/claude"
}

run_in() { # <dir>
	OUT="$WORK/.out"
	set +e
	(cd "$1" && PATH="$BIN:$PATH" "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

ONE='{ "enabledPlugins": { "layering@bp": true } }'
HERE_PATH_A="$WORK/installed-a"
mkdir -p "$HERE_PATH_A"

fixture "$ONE"
stub_claude 0 "[{\"id\":\"layering@bp\",\"enabled\":true,\"installPath\":\"$HERE_PATH_A\"}]"
run_in "$R"
check "a roster that resolves is clean" 0 "$RC" "declared practice(s) resolve"
check "the clean line counts what it checked" 0 "$RC" "1 declared practice(s) resolve"

fixture "$ONE"
stub_claude 0 '[]'
run_in "$R"
check "a declared name nothing installed exits 2" 2 "$RC" "not installed on this machine"

fixture "$ONE"
stub_claude 0 "[{\"id\":\"layering@bp\",\"enabled\":false,\"installPath\":\"$HERE_PATH_A\"}]"
run_in "$R"
check "installed but disabled exits 2" 2 "$RC" "disabled, so nothing can invoke it"

fixture "$ONE"
stub_claude 0 '[{"id":"layering@bp","enabled":true,"installPath":"/nonexistent/path"}]'
run_in "$R"
check "installed with no files on disk exits 2" 2 "$RC" "files are not on disk"

fixture "$ONE"
stub_claude 0 "[{\"id\":\"layering@bp\",\"enabled\":false,\"scope\":\"user\",\"installPath\":\"$HERE_PATH_A\"},{\"id\":\"layering@bp\",\"enabled\":true,\"scope\":\"project\",\"projectPath\":\"$R\",\"installPath\":\"$HERE_PATH_A\"}]"
run_in "$R"
check "enabled for this project outweighs disabled at user scope" 0 "$RC" "declared practice(s) resolve"

fixture "$ONE"
stub_claude 0 "[{\"id\":\"layering@bp\",\"enabled\":true,\"scope\":\"project\",\"projectPath\":\"$R\",\"installPath\":\"$HERE_PATH_A\"},{\"id\":\"layering@bp\",\"enabled\":false,\"scope\":\"user\",\"installPath\":\"$HERE_PATH_A\"}]"
run_in "$R"
check "and the verdict does not depend on which row came last" 0 "$RC" "declared practice(s) resolve"

fixture "$ONE"
stub_claude 0 "[{\"id\":\"layering@bp\",\"enabled\":true,\"scope\":\"project\",\"projectPath\":\"/somewhere/else\",\"installPath\":\"$HERE_PATH_A\"}]"
run_in "$R"
check "a row for another checkout does not resolve a name here" 2 "$RC" "not installed on this machine"

fixture "$ONE"
stub_claude 0 '{"installed":[]}'
run_in "$R"
check "an installed list that is not a list exits 2, and says so" 2 "$RC" "something other than a list"

fixture '{ "enabledPlugins": { "layering@bp": true, "other@bp": false } }'
stub_claude 0 "[{\"id\":\"layering@bp\",\"enabled\":true,\"installPath\":\"$HERE_PATH_A\"}]"
run_in "$R"
check "a practice switched off is not part of the roster" 0 "$RC" "1 declared practice(s) resolve"

fixture "$ONE"
stub_claude 1 '[]'
run_in "$R"
check "a CLI that fails exits 2" 2 "$RC" "could not list installed plugins"

# PATH is replaced, not prefixed: emptying the stub dir leaves the real `claude`
# further along it. `git` and `node` are stubbed so the gate reaches this check.
fixture "$ONE"
rm -rf "$BIN"
mkdir -p "$BIN"
{
	printf '#!/bin/sh\n'
	printf 'if [ "$1" = rev-parse ]; then printf %s %s\n' '%s\\n' "$R"
	printf '\texit 0\nfi\nexit 1\n'
} > "$BIN/git"
printf '#!/bin/sh\nexit 0\n' > "$BIN/node"
chmod +x "$BIN/git" "$BIN/node"
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$BIN" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "no claude on PATH exits 2, not 0" 2 "$RC" "no claude, so the roster cannot be resolved"

fixture "$ONE"
rm "$R/.claude/settings.json"
stub_claude 0 '[]'
run_in "$R"
check "no settings file exits 2, not 0" 2 "$RC" "cannot read .claude/settings.json"

fixture '{ "enabledPlugins": {} }'
stub_claude 0 '[]'
run_in "$R"
check "an empty roster exits 2, not 0" 2 "$RC" "declares no enabled practice"

fixture 'not json at all'
stub_claude 0 '[]'
run_in "$R"
check "unparseable settings exits 2, not 0" 2 "$RC" "declares no enabled practice"

stub_claude 0 '[]'
run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

done_ "check-roster.test.sh"
