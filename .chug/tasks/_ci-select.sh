#!/bin/sh
# Change selection for ci.sh. The caller owns execution and verdicts; this
# library only resolves a diff and answers whether a gate or shell suite is in
# its dependency cone.
#
# A MARKDOWN FILE IS IN NO CODE GATE'S CONE. The gates that prove something of
# the code — the suites, the servers, the console, the model — select on the
# directories they read, and a page kept in one of those directories is read
# by none of them: the documentation gates hold it, and they select on it
# wherever it is.
#
# WHAT THAT CANNOT SEE is a suite that takes a tracked page as its input. One
# that does asks for the page by name on its gate's line, with `ci_changed`,
# which reads every changed file: the unit suites hold the runbook's table of
# the API's variables to the root that reads them.
#
# A PATH THAT WENT AWAY IS A PATH THAT CHANGED. The list holds a deleted file
# and both names of a renamed one, because an absence breaks what a gate
# proves as surely as an edit does: a suite imports the file, a page names it.
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

# A diff of the package files that cannot be read is one that may have moved
# quint, so it selects.
ci_quint_moved() {
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	ci_changed package.json package-lock.json || return 1
	moved="$(git diff "$CI_MERGE_BASE" -- package.json package-lock.json 2>/dev/null || true)"
	[ -n "$moved" ] || return 0
	printf '%s\n' "$moved" | grep -q '^[-+].*@informalsystems/quint'
}

ci_gate_selected() { # <gate id>
	gate="$1"
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	ci_changed .chug/tasks/ci.sh .chug/tasks/_ci-select.sh && return 0

	case "$gate" in
	doc-lint) ci_changed '*.md' .chug/tasks/doc-lint.sh ;;
	check-figures) ci_changed '*.md' '*.svg' '*.png' '*.jpg' '*.jpeg' .chug/tasks/check-figures.sh ;;
	check-paths) ci_changed '*.md' '*.ts' '*.tsx' '*.js' '*.cjs' '*.json' '*.sh' .chug/tasks/check-paths.sh ;;
	check-shell-quoting) ci_changed '*.sh' .githooks/pre-commit .chug/tasks/check-shell-quoting.sh ;;
	check-duplication) ci_changed '*.ts' '*.tsx' '*.js' '*.sh' '*.qnt' .jscpd.json .chug/tasks/check-duplication.sh || ci_toolchain_changed ;;
	check-console-sheets) ci_changed 'ui/chuggy-ui/app/*.css' .chug/tasks/check-console-sheets.sh ;;
	check-gates) ci_changed '.chug/tasks/*.sh' .githooks/pre-commit .chug/tasks/check-gates.sh ;;
	check-comments) ci_changed '*.ts' '*.tsx' .chug/tasks/check-comments.sh ;;
	check-knowledge) ci_changed '.chug/**' 'docs/design/*.md' CLAUDE.md .chug/tasks/check-knowledge.sh ;;
	check-roster) ci_changed CLAUDE.md '.agents/**' '.codex/**' .chug/tasks/check-roster.sh ;;
	check-vendored) ci_changed 'model/task-contract/**' 'model/ticket-domain/**' model/vendored.sha256 .chug/tasks/check-vendored.sh ;;
	check-boundaries) ci_changed 'src/*.ts' 'src/**/*.ts' 'test/*.ts' 'test/**/*.ts' 'scripts/*.ts' 'scripts/**/*.ts' 'ui/*.js' 'ui/**/*.js' 'ui/**/*.ts' 'ui/**/*.tsx' .dependency-cruiser.cjs .chug/tasks/check-boundaries.sh || ci_toolchain_changed ;;
	source-static) ci_changed '*.ts' '*.tsx' '*.js' '*.json' '*.cjs' '*.yaml' '*.yml' .chug/tasks/check-source.sh || ci_toolchain_changed ;;
	source-unit) ci_code_changed 'src/**' 'test/**' 'ui/**' 'images/**' 'scripts/**' 'deploy/**' 'model/**' '.chug/configurations/**' tsconfig.contract.json tsconfig.contract-pack.json .chug/tasks/check-source.sh .chug/tasks/check-console-sheets.sh || ci_changed deploy/rig/images/README.md || ci_toolchain_changed ;;
	check-console) ci_code_changed 'ui/**' 'src/contract/**' '.chug/configurations/**' 'scripts/console-policy.ts' 'scripts/check-console-policy.ts' .chug/tasks/check-console.sh ;;
	check-conformance) ci_code_changed 'src/domain/**' 'test/conformance/**' 'test/domain/**' 'test/itf/**' 'test/golden/**' 'model/domain.qnt' 'model/ticket.qnt' 'model/ticket-domain/**' 'model/task-contract/**' .chug/tasks/check-conformance.sh ;;
	check-random) ci_code_changed 'src/domain/**' 'test/random/**' 'test/conformance/**' 'test/domain/**' 'test/itf/**' 'model/domain.qnt' 'model/ticket.qnt' 'model/ticket-domain/**' 'model/task-contract/**' 'model/mc/mc_chuggy.qnt' .chug/tasks/check-random.sh ;;
	check-postgres) ci_code_changed 'src/**' 'test/postgres/**' deploy/rig/wipe-tickets.sql .chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts .chug/tasks/check-postgres.sh || ci_toolchain_changed ;;
	check-queries) ci_code_changed 'src/adapters/postgres/**' 'src/domain/**' 'src/interpreter/**' eslint.config.js .chug/tasks/_postgres.sh .chug/tasks/check-queries.sh || ci_toolchain_changed ;;
	check-keto) ci_code_changed 'src/**' 'test/keto/**' 'test/postgres/**' '.chug/tasks/keto/**' .chug/tasks/_keto.sh .chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts .chug/tasks/check-keto.sh || ci_toolchain_changed ;;
	check-model) ci_code_changed 'model/**' .chug/tasks/check-model.sh || ci_quint_moved ;;
	check-model-api) ci_code_changed 'model/**' scripts/generate-model-api.ts src/generated/model-api.ts .chug/tasks/check-model-api.sh package.json package-lock.json ;;
	*) return 0 ;;
	esac
}

ci_suite_selected() { # <suite path>
	suite="$1"
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	ci_changed "$suite" && return 0
	case "$suite" in
	.chug/tasks/*.test.sh)
		gate="${suite%.test.sh}.sh"
		ci_changed "$gate" '.chug/tasks/_*.sh'
		;;
	.githooks/pre-commit.test.sh) ci_changed .githooks/pre-commit ;;
	*.test.sh) ci_changed "${suite%.test.sh}.sh" ;;
	*) return 1 ;;
	esac
}
