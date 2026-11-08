#!/bin/sh
# The console's copy catalog is whole, references its terms, and is what the
# modules generated from it say it is.
#
# THE CATALOG is `ui/chuggy-ui/app/copy/`: the base language in `en/`, a file
# per section, its terms in `terms.ftl` alone, and each vernacular a layer over
# it in a directory of its own named `en-x-<name>`. The gate fails where:
#
#   - a file does not parse cleanly. A piece the parser could not read is
#     dropped from the bundle at run time, and its messages with it.
#   - a message spells out a term's English instead of referencing the term,
#     since a vernacular that renames the term would leave that word behind.
#     A homonym is real ("Run now" is a verb; a run is a noun), so a message may
#     carry `# spells -<term>: <why>` in the comment beside it, and an exemption
#     whose message no longer spells the term is a finding too.
#   - a message id is not kebab-case under its section's name, an id is
#     defined twice, or a term sits outside `terms.ftl`.
#   - a vernacular defines an id the base does not, or with other variables.
#     It is a layer that overrides, so either would be a word no base
#     message could reach, or a message formatted without what it names.
#   - a module under `ui/chuggy-ui/app/core/generated/` or
#     `ui/chuggy-ui/app/copy/generated/` differs from what its file generates,
#     or no file generates it. The first are the types that make a misspelled
#     id or a missing variable a compile error, so stale ones admit exactly
#     that; the second are the text the catalog loads, so a stale one draws
#     words the `.ftl` no longer says.
#
# WHAT IT CANNOT SEE. Whether a word is a term at all is the catalog's to say;
# the gate holds a message only to the terms `terms.ftl` defines, matched as
# whole words in any case. Text a component spells is the console's lint's
# (`copy/no-literal-text`), not this gate's.
#
# Usage:
#   .chug/tasks/check-console-copy.sh
#
# Exits 0 clean, 1 on a finding, 2 when it could not run.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-console-copy: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

if ! command -v node >/dev/null 2>&1; then
	echo "check-console-copy: LINTER ERROR — no node, so the catalog cannot be read"
	exit 2
fi
if [ ! -f node_modules/@fluent/syntax/package.json ]; then
	echo "check-console-copy: LINTER ERROR — no @fluent/syntax in node_modules. Install with \`npm ci\`."
	exit 2
fi

set +e
node ui/chuggy-ui/tools/copyCatalog.ts --check
rc=$?
set -e
case "$rc" in
0) ;;
1) exit 1 ;;
*) exit 2 ;;
esac
