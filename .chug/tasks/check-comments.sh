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
# WHAT IT READS is the tree's own pinned TypeScript parser's account of each
# file, a `*.tsx` parsed as markup. A comment is the trivia before a token, so
# the inside of a string, a template, a regex literal or JSX text is never read
# as one, and a comment after markup is judged exactly as one before it. That
# is why the gate needs `npm ci`, and says so with exit 2 when it is absent.
#
# WHAT IT CANNOT SEE. Sentence counting is terminator counting, so an
# abbreviation with a period in it reads as a sentence boundary and a
# semicolon-joined pair reads as one sentence. Both errors point the same way,
# toward shorter comments. A file that does not parse is judged as the parser
# recovers it; rejecting it is the compiler's.
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

# The parser is the tree's own pinned one: a verdict that depends on which
# version happens to be installed is not a verdict.
if ! command -v node >/dev/null 2>&1; then
	echo "check-comments: LINTER ERROR — no node, so nothing can parse the corpus"
	exit 2
fi
if [ ! -f node_modules/typescript/package.json ]; then
	echo "check-comments: LINTER ERROR — no typescript in node_modules. Install with \`npm ci\`."
	exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

set +e
node -e '
const ts = require(process.cwd() + "/node_modules/typescript");
const fs = require("node:fs");

/* The rules that exist to be unsuppressible: the boundary, purity and
   exhaustiveness rules this tree states as house rules. */
const sealed = new Set([
	"@typescript-eslint/switch-exhaustiveness-check",
	"no-restricted-globals",
	"no-restricted-imports",
	"no-restricted-properties",
	"@typescript-eslint/no-floating-promises",
	"@typescript-eslint/no-misused-promises",
]);

/* Every comment is trivia before some token, and JSX text is a token whose
   content is never trivia: so the parser tree, read leaf by leaf, finds each
   comment once and nothing that only looks like one. */
function commentsOf(file, text) {
	const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
	const found = new Map();
	const leaf = (node) => {
		if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces) return;
		for (const read of [ts.getTrailingCommentRanges, ts.getLeadingCommentRanges])
			for (const range of read(text, node.pos) ?? []) found.set(range.pos, range);
	};
	const visit = (node) => {
		if (node.kind <= ts.SyntaxKind.LastToken) return leaf(node);
		for (const child of node.getChildren(sf)) if (!ts.isJSDoc(child)) visit(child);
	};
	visit(sf);
	const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
	return [...found.values()]
		.sort((a, b) => a.pos - b.pos)
		.map((range) => ({ body: text.slice(range.pos, range.end), line: lineOf(range.pos) }));
}

function judgeDoc(body) {
	const prose = body
		.slice(3, -2)
		.replace(/\n/g, "")
		.replace(/\*/g, " ")
		.replace(/`[^`]*`/g, "X");
	const sentences = (prose.match(/[.!?]+([ \t\n]|$)/g) ?? []).length;
	if (sentences > 2) return "a doc comment of " + sentences + " sentences; the cap is two";
}

function judgeLine(rest) {
	const trimmed = rest.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
	if (/^@ts-ignore/.test(trimmed))
		return "@ts-ignore suppresses without saying what it expected; use @ts-expect-error";
	if (/^@ts-expect-error/.test(trimmed)) {
		if (trimmed.length - "@ts-expect-error".length < 10)
			return "@ts-expect-error needs a description of what is expected";
		return;
	}
	if (/^prettier-ignore$/.test(trimmed)) return;
	if (/^jscpd:ignore-(start|end)/.test(trimmed)) {
		if (/^jscpd:ignore-(start|end)$/.test(trimmed))
			return "a jscpd directive states its reason on the directive line";
		return;
	}
	if (/^eslint-disable-next-line[ \t]/.test(trimmed)) {
		const rule = trimmed
			.replace(/^eslint-disable-next-line[ \t]+/, "")
			.replace(/[ \t]*--.*$/, "")
			.replace(/[ \t]+$/, "");
		if (rule === "") return "eslint-disable-next-line names the rule it disables";
		if (sealed.has(rule))
			return rule + " is a boundary, purity or exhaustiveness rule and is not suppressible";
		return;
	}
	return "a line comment; /** */ is the only prose a source file carries";
}

for (const file of process.argv.slice(1)) {
	let seenHeader = false;
	for (const { body, line } of commentsOf(file, fs.readFileSync(file, "utf8"))) {
		let finding;
		if (body.startsWith("//")) finding = judgeLine(body.slice(2));
		else if (body.length < 4 || !body.endsWith("*/")) finding = "unterminated comment";
		else if (!body.startsWith("/**") || body === "/**/") finding = "a block comment that is not a doc comment";
		/* The first doc comment in a file is the module header and carries no cap. */
		else if (!seenHeader) seenHeader = true;
		else finding = judgeDoc(body);
		if (finding) console.log("ERROR " + file + ":" + line + ": " + finding);
	}
}
' -- "$@" >"$work/findings" 2>"$work/err"
rc=$?
set -e
if [ "$rc" -ne 0 ]; then
	echo "check-comments: LINTER ERROR — the parser could not read the corpus (rc=$rc)"
	sed 's/^/    /' "$work/err"
	exit 2
fi

cat "$work/findings"
found="$(grep -c . "$work/findings" || true)"
echo "check-comments: $found finding(s) across $(printf '%s' "$files" | grep -c .) file(s)"
[ "$found" -eq 0 ]
