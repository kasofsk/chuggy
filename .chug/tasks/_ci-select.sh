#!/bin/sh
# Change selection for ci.sh, and the inputs it selects on. The caller owns
# execution and verdicts; this library declares what each gate and shell suite
# reads, resolves a diff, and answers whether a change touched what it reads.
#
# WHAT A GATE OR SUITE READS IS DECLARED ONCE, in `ci_declare`, and that one
# declaration both selects it and keys it: ci.sh hands the same git pathspecs
# to `track-record run --inputs`, and the same packages to the install record
# its key holds, so a file a gate reads that the declaration misses is missed
# by both and is fixed in one place. A gate declared `ci_tree` is the
# exception: its pathspecs select it, and its key holds the whole tree. Under
# a token, a pathspec that matches no tracked file is Track Record's refusal,
# a could-not-run, so a declaration cannot go on naming a file the tree no
# longer holds.
#
# THE DECLARATION IS A LIST OF READS, NOT A PROOF OF ONE. A file a gate opens
# by a path it builds, a suite `find` lists, a module a child process imports:
# each is in the declaration only because someone put it there. An untracked
# file is the one case Track Record covers for it, since one within a key's
# inputs means no lookup and no record, so a suite check-postgres or
# check-keto finds but git does not track never earns a pass.
#
# A PLACE A TOOL LOOKS IS AN INPUT WHILE IT HOLDS NOTHING. Prettier, ESLint,
# Vite, PostCSS and browserslist look for their settings in each directory
# above the files they read, npm for its own, and node for a package in each
# `node_modules` above the module that asks and for its type in each manifest
# above it, so a file arriving in one changes what a gate runs. `ci_probes`
# declares each such place the gate's other inputs leave out, `ci_node_looks`
# node's from a directory its modules sit in, and `ci_compiler_looks` Vite's:
# a change there that git does not ignore selects the gate, and its key holds
# what `.chug/tasks/_probed-inputs.sh` prints of it, ignored and untracked
# files alike, since a pathspec matching no tracked file would be Track
# Record's refusal.
#
# A GATE THAT READS THE TREE AS TEXT RUNS ON ANY CHANGE. Each holds the tree's
# own files to one rule and is quick, and a cone for one is a second list of
# what it reads that falls behind the first: a figure in a recipe, a manifest
# only a page named. The static checks and the clone detector are the same
# for code: they own every kind of file their tools know, a page is the one
# kind none of them reads, and so they run on any change but a page's.
#
# A MARKDOWN FILE IS IN NO CODE GATE'S CONE. `ci_code` declares what a gate
# reads as code, and a page kept there is read by none of the gates that
# prove something of the code — the suites, the servers, the model: the gates
# that read text hold it. A gate that takes a page as its input declares it
# with `ci_text`, under which a page selects: the unit suites hold the
# runbook's table of the API's variables to the root that reads them and the
# action directory's example to the importer that reads it, and the console's
# build takes the names of classes from every file under the console, a page
# among them. A key holds the pages under both, since a key wider than what a
# gate reads costs a reuse and never a verdict.
#
# A PATH THAT WENT AWAY IS A PATH THAT CHANGED. A change holds a deleted file
# and both names of a renamed one, because an absence breaks what a gate
# proves as surely as an edit does: a suite imports the file, a page names it.
#
# A NAME THAT IS NOT A LINE SELECTS EVERYTHING. Git writes a name holding a
# tab, a quote, a backslash or a newline in quotes, which no pathspec here
# reads, so a change that carries one is run in full, and so is a change git
# cannot list. A listing that fails for one declaration selects what it
# declares.
#
# THE SEQUENCER AND THIS LIBRARY SELECT EVERY GATE, and enter no gate's key:
# they decide what runs and ask no gate anything.
#
# A SUITE THAT RUNS ITS GATE OVER THE TREE ITSELF DECLARES THE GATE'S INPUTS.
# Most suites hold a gate to fixtures, and read the gate's script, the harness
# and what else they copy. The replays', the generated API's, the golden
# emitter's and the shell-quoting gate's run over the tree's own files, so
# their declarations hold their gate's, and the random replay's copies the
# sources and the tests whole.
#
# A GATE THAT READS NAMED PACKAGES FOLLOWS THEM, NOT THE PACKAGE FILES. Quint
# is all `check-model` takes from them, so the lock moving selects it only
# where the closure `.chug/tasks/_installed-inputs.sh` prints for quint moved
# between the base and the tree, and a lock that cannot be read at either end
# selects. A gate that reads the whole install is selected by any change to
# the lock.

ci_select_init() {
	CI_SELECT_MODE=full
	CI_CHANGED_FILES=""
	CI_MERGE_BASE=""
	CI_SEQUENCER_CHANGED=0

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
	if ! CI_CHANGED_FILES="$(ci_changed_list 2>/dev/null)"; then
		CI_CHANGED_FILES=""
		CI_SELECT_REASON="the change since $merge_base cannot be listed"
		return 0
	fi
	CI_CHANGED_FILES="$(printf '%s\n' "$CI_CHANGED_FILES" | sort -u | sed '/^$/d')"
	if printf '%s\n' "$CI_CHANGED_FILES" | grep -q '^"'; then
		CI_CHANGED_FILES=""
		CI_SELECT_REASON="a changed path's name cannot be read as a line"
		return 0
	fi
	CI_SELECT_MODE=changed
	CI_SELECT_REASON="changes since $merge_base"
	if [ -n "$CI_CHANGED_FILES" ] && ci_changed_within .chug/tasks/ci.sh .chug/tasks/_ci-select.sh; then
		CI_SEQUENCER_CHANGED=1
	fi
}

# What changed since the merge base, committed, staged, left in the tree or
# untracked, among the paths the pathspecs match, or anywhere given none.
ci_changed_list() { # [<pathspec>...]
	git -c core.quotePath=false diff --name-only --no-renames "$CI_MERGE_BASE" HEAD -- "$@" &&
		git -c core.quotePath=false diff --name-only --no-renames -- "$@" &&
		git -c core.quotePath=false diff --cached --name-only --no-renames -- "$@" &&
		git -c core.quotePath=false ls-files --others --exclude-standard -- "$@"
}

ci_changed_within() { # <pathspec>...
	ci_within="$(ci_changed_list "$@" 2>/dev/null)" || return 0
	[ -n "$ci_within" ]
}

# The declaration's verbs, each appending to what `ci_inputs` reports.
ci_code() { # <pathspec>...
	for ci_spec do CI_INPUTS_CODE="$CI_INPUTS_CODE$ci_spec
"; done
}
ci_text() { # <pathspec>...
	for ci_spec do CI_INPUTS_TEXT="$CI_INPUTS_TEXT$ci_spec
"; done
}
ci_packages() { # <package>... — each with what it depends on, as npm installed them
	for ci_spec do CI_INPUTS_PACKAGES="$CI_INPUTS_PACKAGES$ci_spec
"; done
}
ci_probes() { # <pathspec>... — where a tool looks for a file the tree need not hold
	for ci_spec do CI_INPUTS_PROBES="$CI_INPUTS_PROBES$ci_spec
"; done
}
# Where node looks from a module in each directory given: the directory's
# node_modules for a package the module asks for, and its manifest for the
# module's type.
ci_node_looks() { # <directory>...
	for ci_dir do ci_probes "$ci_dir/node_modules" "$ci_dir/package.json"; done
}
# Vite takes a module's compiler settings from the nearest tsconfig above it.
ci_compiler_looks() { # <directory>...
	for ci_dir do ci_probes "$ci_dir/tsconfig.json"; done
}
ci_install() { CI_INPUTS_INSTALL=1; }
ci_tree() { CI_INPUTS_TREE=1; }

# Every package manifest, for a gate that runs node over files below the
# root: node takes a module's type from the nearest manifest above it, and npm
# reads every workspace's, so one arriving between a gate's files and the root
# changes what it runs.
ci_manifests() { ci_code ':(glob)**/package.json'; }

# The root's tools and their settings, for a gate that runs them over the tree.
ci_toolchain() {
	ci_code package.json package-lock.json tsconfig.json eslint.config.js \
		.prettierrc.json .dependency-cruiser.cjs
	ci_install
}

# What a gate or suite reads: $CI_INPUTS_CODE, $CI_INPUTS_TEXT and
# $CI_INPUTS_PROBES, a git pathspec a line; $CI_INPUTS_PACKAGES, a package a
# line; $CI_INPUTS_INSTALL, 1 for the whole install; and $CI_INPUTS_TREE, 1
# for a key on the whole tree.
# A gate it does not name is read as text from the whole tree and keyed on it.
ci_inputs() { # <gate id or suite path>
	CI_INPUTS_CODE=""
	CI_INPUTS_TEXT=""
	CI_INPUTS_PROBES=""
	CI_INPUTS_PACKAGES=""
	CI_INPUTS_INSTALL=0
	CI_INPUTS_TREE=0
	ci_declare "$1"
}

ci_declare() { # <gate id or suite path>
	case "$1" in
	doc-lint | check-figures | check-paths | check-shell-quoting | check-console-sheets | \
		check-gates | check-comments | check-knowledge | check-vendored)
		ci_tree
		ci_text .
		;;
	check-duplication | source-static)
		ci_tree
		ci_code .
		;;
	check-roster)
		ci_tree
		ci_text .claude/settings.json CLAUDE.md .agents .codex .chug/tasks/check-roster.sh
		;;
	check-boundaries)
		ci_tree
		ci_code src test scripts ui .chug/tasks/check-boundaries.sh
		ci_toolchain
		;;
	source-unit)
		ci_tree
		ci_code src test ui images scripts deploy model .chug/configurations \
			.chug/workloads .chug/actions tsconfig.contract.json tsconfig.contract-pack.json \
			.chug/tasks/check-source.sh .chug/tasks/check-console-sheets.sh
		ci_text deploy/rig/images/README.md .chug/actions/README.md .chug/prompts \
			.chug/tasks/review-change.md
		ci_toolchain
		;;
	check-console)
		ci_text ui
		ci_code src/contract test/fixtures/configurations .chug/configurations \
			scripts/console-policy.ts scripts/check-console-policy.ts package-lock.json \
			tsconfig.json .gitignore .prettierrc.json .prettierignore .chug/tasks/check-console.sh
		ci_probes .browserslistrc browserslist .editorconfig .npmrc .prettierrc package.yaml \
			lerna.json pnpm-workspace.yaml ':(glob).postcssrc*' ':(glob)postcss.config.*'
		ci_node_looks src
		ci_compiler_looks src
		ci_manifests
		ci_install
		;;
	check-conformance)
		ci_code src/domain src/generated test/conformance test/domain test/itf test/golden \
			model .chug/tasks/check-conformance.sh
		ci_node_looks src
		ci_manifests
		ci_packages zod
		;;
	check-random)
		ci_code src/domain src/generated test/random test/conformance test/domain test/itf \
			model .chug/tasks/check-random.sh
		ci_node_looks src
		ci_manifests
		ci_packages zod
		;;
	check-postgres)
		ci_code src test deploy/rig/wipe-tickets.sql package.json .chug/tasks/_postgres.sh \
			.chug/tasks/postgres-databases.ts .chug/tasks/check-postgres.sh
		ci_node_looks .chug/tasks .chug
		ci_install
		;;
	check-queries)
		ci_code src test scripts ui package.json tsconfig.json eslint.config.js \
			.chug/tasks/_postgres.sh .chug/tasks/check-queries.sh
		ci_probes ':(glob)eslint.config.*' .eslintignore .eslintcache eslint-suppressions.json
		ci_install
		;;
	check-keto)
		ci_code src test .chug/tasks/keto package.json .chug/tasks/_keto.sh \
			.chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts .chug/tasks/check-keto.sh
		ci_node_looks .chug/tasks .chug
		ci_install
		;;
	check-model)
		ci_code ':(glob)model/**/*.qnt' .chug/tasks/check-model.sh
		ci_packages @informalsystems/quint
		;;
	check-model-api)
		ci_code ':(glob)model/**/*.qnt' scripts/generate-model-api.ts src/generated \
			src/domain/generated .chug/tasks/check-model-api.sh
		ci_node_looks scripts
		ci_manifests
		ci_packages @informalsystems/quint prettier
		;;
	.chug/tasks/ci.test.sh)
		ci_code "$1" .chug/tasks/ci.sh .chug/tasks/_ci-select.sh .chug/tasks/_ignored-inputs.sh \
			.chug/tasks/_installed-inputs.sh .chug/tasks/_probed-inputs.sh .chug/tasks/_suite.sh \
			justfile package.json
		;;
	.chug/tasks/check-source.test.sh)
		ci_code "$1" .chug/tasks/check-source.sh .chug/tasks/_suite.sh tsconfig.json \
			tsconfig.contract.json eslint.config.js .prettierrc.json .prettierignore package.json
		ci_install
		;;
	.chug/tasks/check-boundaries.test.sh)
		ci_code "$1" .chug/tasks/check-boundaries.sh .chug/tasks/_suite.sh tsconfig.json \
			.dependency-cruiser.cjs package.json
		ci_install
		;;
	.chug/tasks/check-duplication.test.sh)
		ci_code "$1" .chug/tasks/check-duplication.sh .chug/tasks/_suite.sh .jscpd.json package.json
		ci_install
		;;
	.chug/tasks/check-comments.test.sh)
		ci_code "$1" .chug/tasks/check-comments.sh .chug/tasks/_suite.sh package.json
		ci_install
		;;
	.chug/tasks/check-conformance.test.sh | .chug/tasks/check-model-api.test.sh | \
		.chug/tasks/check-shell-quoting.test.sh)
		ci_suite_over="${1##*/}"
		ci_code "$1" .chug/tasks/_suite.sh
		ci_declare "${ci_suite_over%.test.sh}"
		;;
	.chug/tasks/check-random.test.sh)
		ci_code "$1" .chug/tasks/_suite.sh src test .chug/tasks/check-conformance.sh
		ci_declare check-random
		;;
	.chug/tasks/emit-goldens.test.sh)
		ci_code "$1" .chug/tasks/emit-goldens.sh .chug/tasks/_suite.sh .gitignore .prettierignore
		ci_packages prettier
		ci_declare check-model
		;;
	.chug/tasks/check-keto.test.sh)
		ci_code "$1" .chug/tasks/check-keto.sh .chug/tasks/_keto.sh .chug/tasks/_postgres.sh \
			.chug/tasks/_gate-fixture.sh .chug/tasks/_suite.sh .chug/tasks/keto
		;;
	.chug/tasks/check-postgres.test.sh | .chug/tasks/check-queries.test.sh)
		ci_code "$1" "${1%.test.sh}.sh" .chug/tasks/_postgres.sh .chug/tasks/_gate-fixture.sh \
			.chug/tasks/_suite.sh
		;;
	.chug/tasks/*.test.sh) ci_code "$1" "${1%.test.sh}.sh" .chug/tasks/_suite.sh ;;
	.githooks/pre-commit.test.sh) ci_code "$1" .githooks/pre-commit .chug/tasks/_suite.sh ;;
	images/worker/core.test.sh) ci_code "$1" images/worker/core.sh .chug/tasks/_suite.sh package.json ;;
	*.test.sh) ci_code "$1" "${1%.test.sh}.sh" .chug/tasks/_suite.sh ;;
	*)
		ci_tree
		ci_text .
		;;
	esac
}

# Whether the change touched what a gate or suite declares it reads.
ci_selected() { # <gate id or suite path>
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	[ -n "$CI_CHANGED_FILES" ] || return 1
	ci_inputs "$1"
	ci_changed_listed "$CI_INPUTS_TEXT" ||
		ci_changed_listed "$CI_INPUTS_CODE" ':(exclude)*.md' ||
		ci_changed_listed "$CI_INPUTS_PROBES" ||
		ci_packages_moved
}

# Whether the change touched what a list of pathspecs, one a line, matches,
# narrowed by any pathspec given beside it; an empty list matches nothing.
ci_changed_listed() { # <pathspecs, one a line> [<pathspec>...]
	[ -n "$1" ] || return 1
	ci_listed="$1"
	shift
	set -f
	IFS='
'
	# shellcheck disable=SC2086 # a pathspec a line, by construction
	set -- $ci_listed "$@"
	unset IFS
	set +f
	ci_changed_within "$@"
}

# Whether the lock moved what the declaration in hand reads of the install.
ci_packages_moved() {
	if [ "$CI_INPUTS_INSTALL" = 1 ] || [ "$CI_INPUTS_TREE" = 1 ]; then
		ci_changed_within package-lock.json
		return
	fi
	[ -n "$CI_INPUTS_PACKAGES" ] || return 1
	ci_changed_within package-lock.json || return 1
	ci_lock_base="$(mktemp)" || return 0
	set -f
	# shellcheck disable=SC2086 # a package a line, by construction
	if git show "$CI_MERGE_BASE:package-lock.json" >"$ci_lock_base" 2>/dev/null &&
		ci_before="$(sh .chug/tasks/_installed-inputs.sh --lock "$ci_lock_base" $CI_INPUTS_PACKAGES 2>/dev/null)" &&
		ci_after="$(sh .chug/tasks/_installed-inputs.sh --lock package-lock.json $CI_INPUTS_PACKAGES 2>/dev/null)"; then
		set +f
		rm -f "$ci_lock_base"
		[ "$ci_before" != "$ci_after" ]
		return
	fi
	set +f
	rm -f "$ci_lock_base"
	return 0
}

ci_gate_selected() { # <gate id>
	[ "$CI_SELECT_MODE" = "full" ] && return 0
	[ "$CI_SEQUENCER_CHANGED" = 1 ] && return 0
	ci_selected "$1"
}

ci_suite_selected() { # <suite path>
	ci_selected "$1"
}
