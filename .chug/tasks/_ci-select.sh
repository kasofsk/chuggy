#!/bin/sh
# Change selection for ci.sh. The caller owns execution and verdicts; this
# library only resolves a diff and answers whether a gate or shell suite is in
# its dependency cone.
#
# A GATE THAT READS THE TREE AS TEXT RUNS ON ANY CHANGE. Each holds the tree's
# own files to one rule and is quick, and a cone for one is a second list of
# what it reads that falls behind the first: a figure in a recipe, a manifest
# only a page named. The static checks and the clone detector are the same
# for code: they own every kind of file their tools know, a page is the one
# kind none of them reads, and so they run on any change but a page's.
#
# A MARKDOWN FILE IS IN NO CODE GATE'S CONE. The gates that prove something of
# the code — the suites, the servers, the model — select on the directories
# they read, and a page kept in one of those directories is read by none of
# them: the gates that read text hold it.
#
# WHAT THAT CANNOT SEE is a gate that takes a tracked page as its input. One
# that does asks for the page on its own line, with `ci_changed`, which reads
# every changed file: the unit suites hold the runbook's table of the API's
# variables to the root that reads them and the action directory's example to
# the importer that reads it, and the console's build takes the names of
# classes from every file under the console, a page among them, and leaves out
# what the tree's ignore file names.
#
# A PATH THAT WENT AWAY IS A PATH THAT CHANGED. The list holds a deleted file
# and both names of a renamed one, because an absence breaks what a gate
# proves as surely as an edit does: a suite imports the file, a page names it.
#
# A NAME THAT IS NOT A LINE SELECTS EVERYTHING. Git writes a name holding a
# tab, a quote, a backslash or a newline in quotes, which no pattern here
# reads, so a change that carries one is run in full.
#
# A SUITE THAT RUNS ITS GATE OVER THE TREE ITSELF IS SELECTED WITH THE GATE.
# Most suites hold a gate to fixtures, and are selected by the gate's script,
# the harness and what else they copy. The replays', the generated API's and
# the golden emitter's run over the sources and the model, so whatever selects
# the gate selects them.
#
# THE MODEL'S GATE FOLLOWS QUINT, NOT THE PACKAGE FILES. Quint is all that
# `check-model` takes from them, at an exact version it refuses to run
# without, so a change to them selects it only where a line naming quint
# moved. What that cannot see is a package quint depends on moving alone.

ci_select_init() {
	CI_SELECT_MODE=full
	CI_CHANGED_FILES=""
	CI_CHANGED_CODE=""
	CI_MERGE_BASE=""

	if [ "${CHUG_CI_FULL:-0}" = "1" ]; then
		CI_SELECT_REASON="CHUG_CI_FULL=1"
		return 0
	fi

	base="${CHUG_CI_BASE:-}"
	if [ -z "$base" ] && [ -n "${GITHUB_BASE_REF:-}" ]; then
		base="origin/$GITHUB_BASE_REF"
	fi
	if [ -z "$base" ]; then
		if git rev-parse --verify origin/main >/dev/null 2>&1; then
			base=origin/main
		elif git rev-parse --verify main >/dev/null 2>&1; then
			base=main
		else
			CI_SELECT_REASON="no default base ref"
			return 0
		fi
	fi

	merge_base="$(git merge-base "$base" HEAD 2>/dev/null || true)"
	if [ -z "$merge_base" ]; then
		CI_SELECT_REASON="base ref $base cannot be resolved"
		return 0
	fi

	CI_MERGE_BASE="$merge_base"
	CI_CHANGED_FILES="$(
		{
			git -c core.quotePath=false diff --name-only --no-renames "$merge_base" HEAD
			git -c core.quotePath=false diff --name-only --no-renames
			git -c core.quotePath=false diff --cached --name-only --no-renames
			git -c core.quotePath=false ls-files --others --exclude-standard
		} 2>/dev/null | sort -u
	)"
	if printf '%s\n' "$CI_CHANGED_FILES" | grep -q '^"'; then
		CI_CHANGED_FILES=""
		CI_SELECT_REASON="a changed path's name cannot be read as a line"
		return 0
	fi
	CI_CHANGED_CODE="$(printf '%s\n' "$CI_CHANGED_FILES" | grep -v '\.md$' || true)"
	CI_SELECT_MODE=changed
	CI_SELECT_REASON="changes since $merge_base"
}

ci_changed_among() { # <changed files> <shell pattern>...
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	among="$1"
	shift
	[ -n "$among" ] || return 1
	for pattern in "$@"; do
		while IFS= read -r file; do
			case "$file" in $pattern) return 0 ;; esac
		done <<-FILES
			$among
		FILES
	done
	return 1
}

ci_changed() { # <shell pattern>...
	ci_changed_among "$CI_CHANGED_FILES" "$@"
}

ci_code_changed() { # <shell pattern>...
	ci_changed_among "$CI_CHANGED_CODE" "$@"
}

ci_toolchain_changed() {
	ci_changed package.json package-lock.json tsconfig.json eslint.config.js \
		.prettierrc.json .dependency-cruiser.cjs
}

# A gate's suite runs the gate over a copy of the tree's own configuration of
# the tools, so that configuration is the suite's input as well as the gate's.
ci_tools_configured_changed() {
	ci_toolchain_changed || ci_changed 'tsconfig*.json' .prettierignore .jscpd.json
}

# A diff of the package files that cannot be read is one that may have moved
# quint, so it selects.
ci_quint_moved() {
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	ci_changed package.json package-lock.json || return 1
	moved="$(git diff --no-color --no-ext-diff "$CI_MERGE_BASE" -- package.json package-lock.json 2>/dev/null || true)"
	[ -n "$moved" ] || return 0
	printf '%s\n' "$moved" | grep -q '^[-+].*@informalsystems/quint'
}

ci_gate_selected() { # <gate id>
	gate="$1"
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	ci_changed .chug/tasks/ci.sh .chug/tasks/_ci-select.sh && return 0

	case "$gate" in
	doc-lint | check-figures | check-paths | check-shell-quoting | check-console-sheets | \
		check-gates | check-comments | check-knowledge | check-vendored)
		[ -n "$CI_CHANGED_FILES" ]
		;;
	check-duplication | source-static) [ -n "$CI_CHANGED_CODE" ] ;;
	check-roster) ci_changed CLAUDE.md '.agents/**' '.codex/**' .chug/tasks/check-roster.sh ;;
	check-boundaries) ci_code_changed 'src/**' 'test/**' 'scripts/**' 'ui/**' .chug/tasks/check-boundaries.sh || ci_toolchain_changed ;;
	source-unit) ci_code_changed 'src/**' 'test/**' 'ui/**' 'images/**' 'scripts/**' 'deploy/**' 'model/**' '.chug/configurations/**' tsconfig.contract.json tsconfig.contract-pack.json .chug/tasks/check-source.sh .chug/tasks/check-console-sheets.sh || ci_changed deploy/rig/images/README.md .chug/actions/README.md || ci_toolchain_changed ;;
	check-console) ci_changed 'ui/**' .gitignore || ci_code_changed 'src/contract/**' '.chug/configurations/**' 'scripts/console-policy.ts' 'scripts/check-console-policy.ts' package.json package-lock.json .chug/tasks/check-console.sh ;;
	check-conformance) ci_code_changed 'src/domain/**' 'src/generated/**' 'test/conformance/**' 'test/domain/**' 'test/itf/**' 'test/golden/**' 'model/**' .chug/tasks/check-conformance.sh ;;
	check-random) ci_code_changed 'src/domain/**' 'src/generated/**' 'test/random/**' 'test/conformance/**' 'test/domain/**' 'test/itf/**' 'model/**' .chug/tasks/check-random.sh ;;
	check-postgres) ci_code_changed 'src/**' 'test/**' deploy/rig/wipe-tickets.sql .chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts .chug/tasks/check-postgres.sh || ci_toolchain_changed ;;
	check-queries) ci_code_changed 'src/**' eslint.config.js .chug/tasks/_postgres.sh .chug/tasks/check-queries.sh || ci_toolchain_changed ;;
	check-keto) ci_code_changed 'src/**' 'test/**' '.chug/tasks/keto/**' .chug/tasks/_keto.sh .chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts .chug/tasks/check-keto.sh || ci_toolchain_changed ;;
	check-model) ci_code_changed 'model/**' .chug/tasks/check-model.sh || ci_quint_moved ;;
	check-model-api) ci_code_changed 'model/**' scripts/generate-model-api.ts 'src/generated/**' 'src/domain/generated/**' .chug/tasks/check-model-api.sh package.json package-lock.json ;;
	*) return 0 ;;
	esac
}

ci_suite_selected() { # <suite path>
	suite="$1"
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	ci_changed "$suite" && return 0
	case "$suite" in
	.chug/tasks/ci.test.sh) ci_changed .chug/tasks/ci.sh '.chug/tasks/_*.sh' justfile ;;
	.chug/tasks/check-source.test.sh | .chug/tasks/check-boundaries.test.sh | .chug/tasks/check-duplication.test.sh)
		ci_changed "${suite%.test.sh}.sh" '.chug/tasks/_*.sh' || ci_tools_configured_changed
		;;
	.chug/tasks/check-conformance.test.sh | .chug/tasks/check-random.test.sh | .chug/tasks/check-model-api.test.sh)
		over="${suite##*/}"
		ci_changed '.chug/tasks/_*.sh' || ci_gate_selected "${over%.test.sh}"
		;;
	.chug/tasks/emit-goldens.test.sh)
		ci_changed .chug/tasks/emit-goldens.sh '.chug/tasks/_*.sh' || ci_gate_selected check-model
		;;
	.chug/tasks/*.test.sh)
		ci_changed "${suite%.test.sh}.sh" '.chug/tasks/_*.sh'
		;;
	.githooks/pre-commit.test.sh) ci_changed .githooks/pre-commit .chug/tasks/_suite.sh ;;
	*.test.sh) ci_changed "${suite%.test.sh}.sh" .chug/tasks/_suite.sh ;;
	*) return 1 ;;
	esac
}
