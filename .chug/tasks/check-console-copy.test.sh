#!/bin/sh
# Shell test for check-console-copy.sh.
#
# Each check the gate's header names gets a fixture catalog carrying the
# defect, beside a clean one the same shape, so a case passes on the finding
# and not on a catalog the tool could not read at all.
#
# Run:  .chug/tasks/check-console-copy.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-console-copy.sh"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
TOOL="$ROOT/ui/chuggy-ui/tools/copyCatalog.ts"

C="$WORK/catalog"
G="$WORK/generated"

# A base language of two sections and a term, and one vernacular renaming the
# term, with its types generated so the case under test is the only defect.
catalog() {
	rm -rf "$C" "$G"
	mkdir -p "$C/en" "$C/en-x-job"
	printf '%s\n' '# rejects: issue, work item' '-ticket = { $case ->' '    [upper] Ticket' '   *[lower] ticket' '}' > "$C/en/terms.ftl"
	printf '%s\n' 'shell-new = New { -ticket }' 'shell-left = { $count } left' > "$C/en/shell.ftl"
	printf '%s\n' 'setup-done = done' > "$C/en/setup.ftl"
	printf '%s\n' '-ticket = { $case ->' '    [upper] Job' '   *[lower] job' '}' > "$C/en-x-job/terms.ftl"
}

generate() {
	node "$TOOL" --catalog="$C" --generated="$G" >/dev/null 2>&1 || true
}

copy_check() { # [<argument>...]
	set +e
	(cd "$ROOT" && node "$TOOL" --check --catalog="$C" --generated="$G" "$@") >"$OUT" 2>&1
	RC=$?
	set -e
}

# --- The tree's own catalog, through the gate ------------------------------

set +e
(cd "$ROOT" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "the tree's catalog is clean and its types current" 0 "$RC" "generated modules current"

set +e
(cd "$WORK" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

# --- A clean fixture, and the count its line reports -------------------------

catalog
generate
copy_check
check "a clean catalog reports the files and layers it read" 0 "$RC" "4 catalog file(s) clean across 1 vernacular(s), generated modules current"

# --- Each defect -------------------------------------------------------------

catalog
generate
printf '%s\n' 'shell-new = New { -ticket' >> "$C/en/shell.ftl"
copy_check
check "a file that does not parse is a finding" 1 "$RC" "shell.ftl:3: does not parse"

catalog
printf '%s\n' 'shell-new = New ticket' 'shell-left = { $count } left' > "$C/en/shell.ftl"
generate
copy_check
check "a message spelling a term's English is a finding" 1 "$RC" "shell-new: spells -ticket instead of referencing it"

catalog
printf '%s\n' 'shell-new = New Tickets' 'shell-left = { $count } left' > "$C/en/shell.ftl"
generate
copy_check
check "a term is matched as a whole word, so its plural is not its singular" 0 "$RC" "generated modules current"

catalog
printf '%s\n' '# spells -ticket: to ticket is a verb here' 'shell-new = Ticket it' 'shell-left = { $count } left' > "$C/en/shell.ftl"
generate
copy_check
check "an exemption beside the message lets it spell the term" 0 "$RC" "generated modules current"

catalog
printf '%s\n' '# spells -ticket: to ticket is a verb here' 'shell-new = New { -ticket }' 'shell-left = { $count } left' > "$C/en/shell.ftl"
generate
copy_check
check "an exemption whose message no longer spells the term is a finding" 1 "$RC" "shell-new: is exempt for -ticket, which it does not spell"

catalog
printf '%s\n' '# spells -job: a word that is no term' 'shell-new = New { -ticket }' 'shell-left = { $count } left' > "$C/en/shell.ftl"
generate
copy_check
check "an exemption for no term is a finding" 1 "$RC" "is exempt for -job, which is no term"

catalog
printf '%s\n' 'shell-new = New issue' 'shell-left = { $count } left' > "$C/en/shell.ftl"
generate
copy_check
check "a message saying a word its term rejects is a finding" 1 "$RC" 'shell-new: says "issue", which -ticket replaces'

catalog
printf '%s\n' 'shell-new = New Work Item' 'shell-left = { $count } left' > "$C/en/shell.ftl"
generate
copy_check
check "a rejected phrase is matched whole and in any case" 1 "$RC" 'shell-new: says "work item", which -ticket replaces'

catalog
printf '%s\n' '# spells -ticket: an issue of a magazine' 'shell-new = New issue' 'shell-left = { $count } left' > "$C/en/shell.ftl"
generate
copy_check
check "the exemption a homonym carries lets a message say a rejected word" 0 "$RC" "generated modules current"

catalog
printf '%s\n' 'shell-new = New { -tikcet }' 'shell-left = { $count } left' > "$C/en/shell.ftl"
generate
copy_check
check "a term reference that resolves to nothing is a finding" 1 "$RC" "shell-new: references -tikcet, which nothing defines"

catalog
printf '%s\n' 'shell-new = New { -ticket }' 'shell-left = { $count } left · { setup-dnoe }' > "$C/en/shell.ftl"
generate
copy_check
check "a message reference that resolves to nothing is a finding" 1 "$RC" "shell-left: references setup-dnoe, which nothing defines"

catalog
printf '%s\n' '-ticket = { -jbo }' > "$C/en-x-job/terms.ftl"
generate
copy_check
check "a layer's reference that resolves to nothing is a finding" 1 "$RC" "-ticket: references -jbo, which nothing defines"

catalog
printf '%s\n' 'shell-new = New { -ticket }' 'shell-left = { $count } left' 'shell-more = More · { shell-left }' > "$C/en/shell.ftl"
generate
copy_check
check "a message reference resolving to a base message is clean" 0 "$RC" "generated modules current"
grep -A1 '"shell-more"' "$G/shellCopy.ts" >"$OUT"
check "a message is typed with the variables of the message it references" 0 "$RC" "readonly count: Argument"

catalog
printf '%s\n' 'shell-other = Other' > "$C/en-x-job/shell.ftl"
generate
copy_check
check "a vernacular defining an id the base does not is a finding" 1 "$RC" "shell-other: is not defined by en"

catalog
printf '%s\n' 'shell-left = { $remaining } left' > "$C/en-x-job/shell.ftl"
generate
copy_check
check "a vernacular formatting an id with other variables is a finding" 1 "$RC" "shell-left: takes { remaining } where en takes { count }"

catalog
mkdir -p "$C/job"
generate
copy_check
check "a vernacular not named as a private use of the base is a finding" 1 "$RC" "a vernacular is named en-x-<name>"

catalog
printf '%s\n' 'new-shell = New { -ticket }' > "$C/en/shell.ftl"
generate
copy_check
check "an id outside its section is a finding" 1 "$RC" "new-shell: is not kebab-case under shell-"

catalog
printf '%s\n' 'setup-done = done' 'setup-done = finished' > "$C/en/setup.ftl"
generate
copy_check
check "an id defined twice is a finding" 1 "$RC" "setup-done: is defined twice"

catalog
printf '%s\n' '-run = run' >> "$C/en/setup.ftl"
generate
copy_check
check "a term outside terms.ftl is a finding" 1 "$RC" "-run: a term belongs in terms.ftl"

# --- The generated types -----------------------------------------------------

catalog
generate
printf '%s\n' 'stale' > "$G/shellCopy.ts"
copy_check
check "a generated module that differs from its section is stale" 1 "$RC" "shellCopy.ts: is stale"

catalog
generate
printf '%s\n' 'shell-new = New { -ticket }' 'shell-left = { $count } left' 'shell-more = More' > "$C/en/shell.ftl"
copy_check
check "a message added without regenerating leaves its module stale" 1 "$RC" "shellCopy.ts: is stale"

catalog
generate
rm "$G/setupCopy.ts"
copy_check
check "a section with no module is stale" 1 "$RC" "setupCopy.ts: is stale"

catalog
generate
printf '%s\n' 'export interface GoneCopy {}' > "$G/goneCopy.ts"
copy_check
check "a module no section generates is stale" 1 "$RC" "goneCopy.ts: is stale: no section generates it"

catalog
generate
printf '%s\n' 'stale' > "$C/generated/shellFtl.ts"
copy_check
check "a generated text that differs from its file is stale" 1 "$RC" "shellFtl.ts: is stale"

catalog
generate
printf '%s\n' 'setup-done = finished' > "$C/en/setup.ftl"
copy_check
check "a file edited without regenerating leaves its text stale" 1 "$RC" "setupFtl.ts: is stale"

catalog
generate
printf '%s\n' 'export const goneFtl = ``;' > "$C/generated/goneFtl.ts"
copy_check
check "a text no file generates is stale" 1 "$RC" "goneFtl.ts: is stale: no section generates it"

catalog
generate
copy_check --out="$G"
check "an unknown argument exits 2, not 0" 2 "$RC" "is not an argument"

done_ "check-console-copy.test.sh"
