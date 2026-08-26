#!/bin/sh
# In TypeScript, `/** */` is the only prose a source file may carry, and a doc
# comment is at most two sentences.
#
# This is house rule 1, and it is about QUANTITY. What a comment may SAY is the
# `comments-describe-the-code` skill's, and both apply to every line here.
#
# THE MODULE HEADER IS EXEMPT, and only it: a file's FIRST `/** */` block,
# stating what the module accepts, emits and guarantees. Every later block in
# the same file is a doc comment and is capped.
#
# WHAT IS REJECTED OUTRIGHT:
#
#   - `//` in any form. `///` and `//!` are Rust syntax and render in no
#     TypeScript tool.
#   - `/* */` that is not `/** */`. A block comment that is not a doc comment
#     is prose the tooling cannot surface.
#   - `@ts-ignore`, which suppresses without saying what it expected. Its
#     replacement `@ts-expect-error` fails when the error goes away, so it
#     cannot outlive the problem it names.
#
# MACHINE-READ DIRECTIVES ARE NOT PROSE, and are allowed from a closed list:
# `jscpd:ignore-start` and `jscpd:ignore-end`, each carrying a reason on the
# directive line; `prettier-ignore`; `@ts-expect-error` with a description; and
# `eslint-disable-next-line` naming a rule that is not one of this tree's
# boundary, purity or exhaustiveness rules — those exist to be unsuppressible.
#
# A DIRECTIVE IS ONE LINE. A wrapped second line is an ordinary comment and is
# rejected as one: the half the tool ignores is where an explanation grows that
# nothing checks.
#
# WHAT IT CANNOT SEE. Sentence counting is terminator counting, so an
# abbreviation with a period in it reads as a sentence boundary and a
# semicolon-joined pair reads as one sentence. Both errors point the same way,
# toward shorter comments. A string literal containing `//` is not a comment,
# and neither is a regex literal matching one; both are tracked.
#
# SCOPE: tracked `*.ts` and `*.tsx`. Both, because a console that builds writes
# its components in the second and they are TypeScript in every way this rule
# is about; a file type left out of the glob is a file type the rule silently
# stops applying to. The gates are shell and the model is Quint; each has its
# own comment culture and its own header stating it.
#
# Usage:
#   .chug/tasks/check-comments.sh [<file>...]
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-comments: LINTER ERROR — not a git checkout, so there is no corpus to read" >&2
	exit 2
fi
cd "$root" || exit 2

set -f
if [ "$#" -eq 0 ]; then
	corpus="$(git ls-files '*.ts' '*.tsx' 2>/dev/null || true)"
	if [ -z "$corpus" ]; then
		echo "check-comments: LINTER ERROR — no tracked *.ts or *.tsx; the glob matched nothing"
		exit 2
	fi
	IFS='
'
	set -- $corpus
	unset IFS
fi
files=""
for f in "$@"; do
	[ -f "$f" ] || continue
	files="$files$f
"
done
set +f

if [ -z "$files" ]; then
	echo "check-comments: no readable files to scan"
	exit 0
fi

set -f
IFS='
'
set -- $files
unset IFS
set +f

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

awk '
BEGIN {
	# The rules that exist to be unsuppressible: the boundary, purity and
	# exhaustiveness rules this tree states as house rules.
	split("@typescript-eslint/switch-exhaustiveness-check no-restricted-globals no-restricted-imports no-restricted-properties @typescript-eslint/no-floating-promises @typescript-eslint/no-misused-promises", unsuppressable, " ")
	for (i in unsuppressable) sealed[unsuppressable[i]] = 1
}

FNR == 1 {
	in_block = 0		# inside a /* ... */ of any kind
	is_doc = 0		# ... and it opened as /**
	seen_header = 0		# the first /** */ block has been closed
	in_regex = 0		# inside a /.../ literal
	in_class = 0		# ... and inside a [...] within it
	doc_text = ""
	doc_start = 0
}

{
	line = $0
	i = 1
	n = length(line)
	in_string = ""
	prev = ""

	while (i <= n) {
		c = substr(line, i, 1)
		two = substr(line, i, 2)

		if (in_block) {
			if (two == "*/") {
				if (is_doc) doc_close()
				in_block = 0
				is_doc = 0
				i += 2
				continue
			}
			if (is_doc) doc_text = doc_text c
			i++
			continue
		}

		if (in_string != "") {
			if (c == "\\") { i += 2; continue }
			if (c == in_string) in_string = ""
			i++
			continue
		}

		if (in_regex) {
			if (c == "\\") { i += 2; continue }
			if (c == "[") in_class = 1
			else if (c == "]") in_class = 0
			else if (c == "/" && !in_class) in_regex = 0
			i++
			continue
		}

		if (c == "\"" || c == "\047" || c == "`") { in_string = c; i++; continue }

		# A regex literal is not a comment. Its ambiguity with division is
		# settled by what precedes the slash: after an operator or an opening
		# bracket a regex may start, after a value only division can.
		if (c == "/" && two != "//" && two != "/*" && index("(,=:[!&|?{};+-~^<>%*", prev) > 0) {
			in_regex = 1
			in_class = 0
			i++
			continue
		}

		if (two == "//") {
			rest = substr(line, i + 2)
			judge_line_comment(rest)
			break
		}

		if (two == "/*") {
			if (substr(line, i, 3) == "/**" && substr(line, i, 4) != "/**/") {
				is_doc = 1
				doc_text = ""
				doc_start = FNR
				i += 3
			} else {
				print "ERROR " FILENAME ":" FNR ": a block comment that is not a doc comment"
				is_doc = 0
				i += 2
			}
			in_block = 1
			continue
		}

		if (c != " " && c != "\t") prev = c
		i++
	}
}

END {
	if (in_block) print "ERROR " FILENAME ":" FNR ": unterminated comment"
}

function doc_close(   sentences, body, capped) {
	# The first block in a file is the module header and carries no cap.
	if (!seen_header) { seen_header = 1; return }

	body = doc_text
	gsub(/\*/, " ", body)
	gsub(/`[^`]*`/, "X", body)
	sentences = gsub(/[.!?]+([ \t\n]|$)/, "&", body)
	if (sentences > 2)
		print "ERROR " FILENAME ":" doc_start ": a doc comment of " sentences " sentences; the cap is two"
}

function judge_line_comment(rest,   trimmed, rule) {
	trimmed = rest
	sub(/^[ \t]+/, "", trimmed)
	sub(/[ \t]+$/, "", trimmed)

	if (trimmed ~ /^@ts-ignore/) {
		print "ERROR " FILENAME ":" FNR ": @ts-ignore suppresses without saying what it expected; use @ts-expect-error"
		return
	}
	if (trimmed ~ /^@ts-expect-error/) {
		if (length(trimmed) - length("@ts-expect-error") < 10)
			print "ERROR " FILENAME ":" FNR ": @ts-expect-error needs a description of what is expected"
		return
	}
	if (trimmed ~ /^prettier-ignore$/) return
	if (trimmed ~ /^jscpd:ignore-(start|end)/) {
		if (trimmed ~ /^jscpd:ignore-(start|end)$/)
			print "ERROR " FILENAME ":" FNR ": a jscpd directive states its reason on the directive line"
		return
	}
	if (trimmed ~ /^eslint-disable-next-line[ \t]/) {
		rule = trimmed
		sub(/^eslint-disable-next-line[ \t]+/, "", rule)
		sub(/[ \t]*--.*$/, "", rule)
		sub(/[ \t]+$/, "", rule)
		if (rule == "") {
			print "ERROR " FILENAME ":" FNR ": eslint-disable-next-line names the rule it disables"
			return
		}
		if (rule in sealed) {
			print "ERROR " FILENAME ":" FNR ": " rule " is a boundary, purity or exhaustiveness rule and is not suppressible"
			return
		}
		return
	}

	print "ERROR " FILENAME ":" FNR ": a line comment; /** */ is the only prose a source file carries"
}
' "$@" > "$work/findings"

cat "$work/findings"
found="$(grep -c . "$work/findings" || true)"
echo "check-comments: $found finding(s) across $(printf '%s' "$files" | grep -c .) file(s)"
[ "$found" -eq 0 ]
