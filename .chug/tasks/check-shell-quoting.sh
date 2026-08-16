#!/bin/sh
# Shell-quoting gate: a quote character inside the word of a `${VAR:-word}`-style
# parameter expansion, where bash reads the quote and dash does not.
#
# The class, in one sentence: in a context that already quotes — inside double
# quotes, or inside an unquoted heredoc body — bash parses quotes INSIDE the
# word of a `${VAR<op>word}` expansion and dash does not, so the same line means
# two different things in the two shells while staying syntactically valid in
# both.
#
#   V=""; M="X is '${V:-this node's CPU count}'"
#     dash: M is `X is 'this node's CPU count'`
#     bash: the apostrophe OPENS a quoted run that swallows the following lines
#           until the next one, binding them into whatever block the line sits in
#
# Why a gate and not just care: the divergence is invisible to
# everything this repo already runs. A POSIX shell always accepts the file, so no
# `sh -n` sweep can see it, and whether BASH rejects it depends only on what
# happens to follow — a later apostrophe closes the run, and then
# `bash -n` passes too and the file is valid in both shells while binding
# different lines in each.
#
# WHICH SHELL READS A SCRIPT HERE IS A PROPERTY OF THE HOST. `.chug/tasks/ci.sh`
# drives every `*.test.sh` suite as `sh "$suite"`: on the developer's macOS
# machine — which is the whole of CI — /bin/sh IS bash, while on a Linux host it
# is usually dash. So the same tree binds different code on two machines, and a
# suite exercising the exact failing input stays green on whichever of them
# reads it the way the author meant.
#
# The damage is worse than a wrong string. The swallowed run carries whatever
# follows it into the quoted text, so a pre-flight guard can end up inside the
# `if` above it and run only when its own check FAILS.
#
# WHICH EXPANSIONS. Every form whose word bash reads: the operator may be any of
# `-` `=` `+` `?`, with or without the leading colon (`${V:-w}` and `${V-w}`
# diverge identically), and the parameter may be a name, a positional (`${1:-w}`)
# or a special parameter (`${@:-w}`). Every operator spelling and every
# parameter form was measured to diverge; the colon-less and positional forms
# are not a lesser case, and `${1:-…}` is in fact the commonest default in this
# tree. Shapes with no word — `${V#pat}`, `${V%%pat}`, `${V//a/b}`, `${V:1:2}`,
# `${#V}` — are not this class and are not matched.
#
# WHICH CONTEXTS, and this is measured rather than assumed (2026-08-08, dash 0.5
# and bash 5.2, the two shells that matter):
#
#   context                  unbalanced quote          balanced quote
#   double-quoted            DIVERGES, silently        diverges if it spans a `}`
#   heredoc, plain delimiter DIVERGES, silently        diverges if it spans a `}`
#   heredoc, quoted delimiter no expansion happens at all — nothing to diverge
#   unquoted word            BOTH shells reject it     both shells agree
#
# So the gate flags the first two rows and stays silent on the last two. The
# unquoted row is the one worth spelling out, because it is the row a purely
# lexical scan would flag by accident: there, POSIX has the word expanded like
# any other word, so `env ${2:+QUINT_SEED="$2"} quint test …` means the same in
# both shells, and an unbalanced quote is a loud syntax error in dash as well as
# bash. Nothing silent survives there, so flagging it would be noise. A command
# substitution is excluded for the same reason: `$(…)` and backticks open a
# fresh parsing context and quote normally in both shells, which is why
# `${DIR:-$(cd "$(dirname "$0")" && pwd)}` is correct and must not be flagged.
#
# Balanced quotes are flagged alongside unbalanced ones. `"${V:-'}'}"` is `'}'`
# in bash and `''}` in dash: the quoted run hides the brace from bash's scan for
# the closing one, which is the same disagreement with a quieter blast radius.
#
# The fix is never an escape. Write the message without the quote — plain prose
# is what the rest of these scripts use — or move the quoted text out of the
# expansion and into the surrounding string.
#
# This is a LEXICAL heuristic, not a shell parser. It tracks quoting, command
# substitution and heredocs a line at a time, so the shapes it cannot see are:
# a double-quoted string continued across a newline (each line is scanned from a
# fresh unquoted state), a `<<\EOF` or `<<` inside an arithmetic `$(( … ))`, a
# nested `${…}` inside the word (which truncates the match), and a trailing
# comment, which is read as code. Whole-line comments are skipped. It is scoped
# to the one divergence CI's shell cannot see, not to shell portability at
# large; it measured zero findings over the tree when it landed, so a finding is
# a real one to look at rather than noise to tune away.
#
# Usage:
#   .chug/tasks/check-shell-quoting.sh            # every tracked shell file
#   .chug/tasks/check-shell-quoting.sh <path>...  # only these (used by the test)
#
# Exit: 0 = clean. 1 = findings (each names file:line and the expansion).
# 2 = the check could not run (no awk, or the glob matched nothing); that is a
# broken gate, never a pass.
set -eu

command -v awk > /dev/null 2>&1 || {
	echo "!!! check-shell-quoting: no \`awk\` on PATH, so nothing was scanned."
	echo "!!!     An unrun gate is not a clean tree."
	exit 2
}

if [ "$#" -gt 0 ]; then
	# Explicit paths are the caller's, so the cwd stays the caller's too; only
	# the whole-tree mode moves to the repo root the glob is relative to.
	FILES="$*"
else
	cd "$(dirname "$0")/../.."
	# Discovery is a glob over `git ls-files`, so a new shell file is picked up
	# with nothing to register. `.githooks/pre-commit` is a shell file with no
	# extension, and it is the other script an operator runs on a mac.
	FILES="$(git ls-files '*.sh' '.githooks/pre-commit' 2> /dev/null || true)"
	[ -n "$FILES" ] || {
		echo "!!! check-shell-quoting: \`git ls-files\` matched no shell files, so the"
		echo "!!!     scan measured nothing. Run this from inside the repository."
		exit 2
	}
fi

FOUND="$(
	# shellcheck disable=SC2086 # word-split the file list into arguments
	awk -v SQ="'" -v DQ='"' '
		function expansion(rest,   token, word, before) {
			if (!match(rest, /^\$\{[A-Za-z_0-9@*#][A-Za-z_0-9]*:?[-=+?][^}]*\}/)) return 0
			token = substr(rest, 1, RLENGTH)
			word = token
			do { before = word; gsub(/\$\([^()]*\)/, "", word) } while (word != before)
			gsub(/`[^`]*`/, "", word)
			if (index(word, SQ) || index(word, DQ))
				printf "%s:%d: %s\n", FILENAME, FNR, token
			return RLENGTH
		}
		FNR == 1 { heredoc = ""; heredoc_quoted = 0; heredoc_dash = 0 }
		{
			line = $0
			n = length(line)
		}
		heredoc != "" {
			term = line
			if (heredoc_dash) sub(/^\t+/, "", term)
			if (term == heredoc) { heredoc = ""; next }
			if (heredoc_quoted) next
			i = 1
			while (i <= n) {
				if (substr(line, i, 2) == "${") {
					adv = expansion(substr(line, i))
					if (adv) { i += adv; continue }
				}
				i++
			}
			next
		}
		/^[[:space:]]*#/ { next }
		{
			single = 0; double = 0; depth = 0; i = 1
			while (i <= n) {
				c = substr(line, i, 1)
				if (single) { if (c == SQ) single = 0; i++; continue }
				if (c == "\\") { i += 2; continue }
				if (c == SQ) { if (!double) single = 1; i++; continue }
				if (c == DQ) { double = 1 - double; i++; continue }
				if (substr(line, i, 2) == "$(") {
					stack[depth] = double; depth++; double = 0; i += 2; continue
				}
				if (c == ")" && depth > 0) { depth--; double = stack[depth]; i++; continue }
				if (!single && !double && depth == 0 && substr(line, i, 2) == "<<" && substr(line, i, 3) != "<<<") {
					j = i + 2
					heredoc_dash = (substr(line, j, 1) == "-")
					if (heredoc_dash) j++
					while (substr(line, j, 1) == " " || substr(line, j, 1) == "\t") j++
					q = substr(line, j, 1)
					heredoc_quoted = (q == SQ || q == DQ || q == "\\")
					if (heredoc_quoted) j++
					if (q == SQ || q == DQ) {
						d = ""
						while (j <= n && substr(line, j, 1) != q) { d = d substr(line, j, 1); j++ }
					} else {
						d = ""
						while (j <= n && substr(line, j, 1) ~ /[A-Za-z_0-9.-]/) { d = d substr(line, j, 1); j++ }
					}
					if (d != "") heredoc = d
					i = j
					continue
				}
				if (double && substr(line, i, 2) == "${") {
					adv = expansion(substr(line, i))
					if (adv) { i += adv; continue }
				}
				i++
			}
		}
	' $FILES
)"

if [ -n "$FOUND" ]; then
	echo "$FOUND"
	echo "!!! check-shell-quoting: a quote inside the word of a \`\${VAR:-word}\` expansion,"
	echo "!!!     which bash and dash parse differently — bash reads the quote, dash does"
	echo "!!!     not, and both accept the file. CI runs dash; macOS /bin/sh is bash, so"
	echo "!!!     this binds different lines in CI than in production. Rewrite the default"
	echo "!!!     without the quote (plain prose), or move the quoted text outside the"
	echo "!!!     expansion. Escaping it is not the fix."
	exit 1
fi

echo "check-shell-quoting: no quote-in-default expansions"
