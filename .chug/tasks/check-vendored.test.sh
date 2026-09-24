#!/bin/sh
# Shell test for check-vendored.sh.
#
# The cases are built in throwaway repos with a two-file package, because the
# real manifest is what the gate is holding and cannot also be its fixture.
#
# Run:  .chug/tasks/check-vendored.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-vendored.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"

# A PATH holding only git, so the hasher probe can be made to fail.
GITBIN="$WORK/gitonly"
mkdir -p "$GITBIN"
ln -sf "$(command -v git)" "$GITBIN/git"

digest() { # <file>
	sha256sum <"$1" | cut -d' ' -f1
}

# A tracked package of two files and a manifest pinning both.
vendored_repo() {
	fresh_repo "$R"
	mkdir -p "$R/model/task-contract" "$R/model/ticket-domain/traces"
	printf 'module task_contract {}\n' >"$R/model/task-contract/task.qnt"
	printf '{"states":[]}\n' >"$R/model/ticket-domain/traces/one.itf.json"
	{
		echo "# repository https://example.com/package"
		echo "# pin 0123456789abcdef0123456789abcdef01234567"
		echo "# command sha256sum model/task-contract/task.qnt model/ticket-domain/traces/*.json"
		echo "$(digest "$R/model/task-contract/task.qnt")  model/task-contract/task.qnt"
		echo "$(digest "$R/model/ticket-domain/traces/one.itf.json")  model/ticket-domain/traces/one.itf.json"
	} >"$R/model/vendored.sha256"
	git -C "$R" add -A
}

run_in() { # <dir> [PATH]
	OUT="$WORK/.out"
	set +e
	if [ $# -gt 1 ]; then
		(cd "$1" && PATH="$2" "$SUT") >"$OUT" 2>&1
	else
		(cd "$1" && "$SUT") >"$OUT" 2>&1
	fi
	RC=$?
	set -e
}

vendored_repo
run_in "$R"
check "a tree matching its pin is clean" 0 "$RC" "0 finding(s) across 2 pinned file(s)"

# One byte of a .qnt and one byte of a trace: the two kinds the package ships.
vendored_repo
printf 'module task_contract {} \n' >"$R/model/task-contract/task.qnt"
run_in "$R"
check "an edited .qnt is a finding" 1 "$RC" "model/task-contract/task.qnt: sha256"

vendored_repo
printf '{"states":[1]}\n' >"$R/model/ticket-domain/traces/one.itf.json"
run_in "$R"
check "an edited trace is a finding" 1 "$RC" "model/ticket-domain/traces/one.itf.json: sha256"

vendored_repo
printf 'extra\n' >"$R/model/ticket-domain/extra.qnt"
git -C "$R" add -A
run_in "$R"
check "a vendored file the manifest does not list is a finding" 1 "$RC" \
	"model/ticket-domain/extra.qnt: vendored and not in"

vendored_repo
git -C "$R" rm -qf model/ticket-domain/traces/one.itf.json
run_in "$R"
check "a listed file that is gone is a finding" 1 "$RC" \
	"model/ticket-domain/traces/one.itf.json: listed in"

# The gate reads git for what is vendored, so a stray working-tree file cannot
# decide a verdict.
vendored_repo
printf 'stray\n' >"$R/model/ticket-domain/stray.qnt"
run_in "$R"
check "an untracked file is not judged" 0 "$RC" "0 finding(s)"

vendored_repo
git -C "$R" rm -qf model/vendored.sha256
run_in "$R"
check "no manifest exits 2" 2 "$RC" "no pin to hold"

vendored_repo
sed -i.bak '/^# pin /d' "$R/model/vendored.sha256"
run_in "$R"
check "a manifest naming no pin exits 2" 2 "$RC" "names no pin"

vendored_repo
grep '^#' "$R/model/vendored.sha256" >"$R/model/vendored.new"
mv "$R/model/vendored.new" "$R/model/vendored.sha256"
run_in "$R"
check "a manifest listing no file exits 2, not 0" 2 "$RC" "lists no file"

vendored_repo
echo "not-a-digest  model/task-contract/task.qnt" >>"$R/model/vendored.sha256"
run_in "$R"
check "a malformed row exits 2" 2 "$RC" "not-a-digest"

vendored_repo
run_in "$R" "$GITBIN"
check "no hasher exits 2, not 0" 2 "$RC" "nothing can be hashed"

run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-vendored.test.sh"
