#!/bin/sh
# Change selection for ci.sh. The caller owns execution and verdicts; this
# library only resolves a diff and answers whether a gate or shell suite is in
# its dependency cone.

ci_select_init() {
	CI_SELECT_MODE=full
	CI_CHANGED_FILES=""

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

	CI_CHANGED_FILES="$(
		{
			git diff --name-only --diff-filter=ACMR "$merge_base" HEAD
			git diff --name-only --diff-filter=ACMR
			git diff --cached --name-only --diff-filter=ACMR
			git ls-files --others --exclude-standard
		} 2>/dev/null | sort -u
	)"
	CI_SELECT_MODE=changed
	CI_SELECT_REASON="changes since $merge_base"
}

ci_changed() { # <shell pattern>...
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	[ -n "$CI_CHANGED_FILES" ] || return 1
	for pattern in "$@"; do
		while IFS= read -r file; do
			case "$file" in $pattern) return 0 ;; esac
		done <<-FILES
			$CI_CHANGED_FILES
		FILES
	done
	return 1
}

ci_toolchain_changed() {
	ci_changed package.json package-lock.json tsconfig.json eslint.config.js \
		.prettierrc.json .dependency-cruiser.cjs
}

ci_gate_selected() { # <gate id>
	gate="$1"
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	ci_changed .chug/tasks/ci.sh .chug/tasks/_ci-select.sh && return 0

	case "$gate" in
	doc-lint) ci_changed '*.md' .chug/tasks/doc-lint.sh ;;
	check-figures) ci_changed '*.md' '*.svg' '*.png' '*.jpg' '*.jpeg' .chug/tasks/check-figures.sh ;;
	check-paths) ci_changed '*.md' '*.ts' '*.tsx' '*.js' '*.sh' .chug/tasks/check-paths.sh ;;
	check-shell-quoting) ci_changed '*.sh' .githooks/pre-commit .chug/tasks/check-shell-quoting.sh ;;
	check-duplication) ci_changed '*.ts' '*.tsx' '*.js' '*.sh' '*.qnt' .jscpd.json .chug/tasks/check-duplication.sh || ci_toolchain_changed ;;
	check-console-sheets) ci_changed 'ui/chuggy-ui/app/*.css' .chug/tasks/check-console-sheets.sh ;;
	check-gates) ci_changed '.chug/tasks/*.sh' .githooks/pre-commit .chug/tasks/check-gates.sh ;;
	check-comments) ci_changed '*.ts' '*.tsx' .chug/tasks/check-comments.sh ;;
	check-knowledge) ci_changed '.chug/**' 'docs/design/*.md' CLAUDE.md .chug/tasks/check-knowledge.sh ;;
	check-roster) ci_changed CLAUDE.md '.agents/**' '.codex/**' .chug/tasks/check-roster.sh ;;
	check-boundaries) ci_changed 'src/*.ts' 'src/**/*.ts' 'test/*.ts' 'test/**/*.ts' 'ui/*.js' 'ui/**/*.js' 'ui/**/*.ts' 'ui/**/*.tsx' .dependency-cruiser.cjs .chug/tasks/check-boundaries.sh || ci_toolchain_changed ;;
	source-static) ci_changed '*.ts' '*.tsx' '*.js' '*.json' '*.cjs' '*.mjs' '*.yaml' '*.yml' .chug/tasks/check-source.sh || ci_toolchain_changed ;;
	source-unit) ci_changed 'src/**' 'test/**' 'ui/**' 'images/**' .chug/tasks/check-source.sh || ci_toolchain_changed ;;
	check-console) ci_changed 'ui/**' 'src/contract/**' 'scripts/console-policy.ts' 'scripts/check-console-policy.ts' .chug/tasks/check-console.sh ;;
	check-conformance) ci_changed 'src/domain/**' 'test/conformance/**' 'test/domain/**' 'test/itf/**' 'test/golden/**' 'model/domain.qnt' 'model/measure.qnt' .chug/tasks/check-conformance.sh ;;
	check-random) ci_changed 'src/domain/**' 'test/random/**' 'test/conformance/**' 'test/domain/**' 'test/itf/**' 'model/domain.qnt' 'model/measure.qnt' 'model/mc/mc_chuggy.qnt' .chug/tasks/check-random.sh ;;
	check-postgres) ci_changed 'src/**' 'test/postgres/**' .chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts .chug/tasks/check-postgres.sh || ci_toolchain_changed ;;
	check-queries) ci_changed 'src/adapters/postgres/**' 'src/domain/**' 'src/interpreter/**' eslint.config.js .chug/tasks/_postgres.sh .chug/tasks/check-queries.sh || ci_toolchain_changed ;;
	check-model) ci_changed 'model/**' .chug/tasks/check-model.sh package.json package-lock.json ;;
	check-model-api) ci_changed 'model/**' scripts/generate-model-api.ts src/generated/model-api.ts .chug/tasks/check-model-api.sh package.json package-lock.json ;;
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
