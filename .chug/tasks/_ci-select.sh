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
# A GATE WHOSE CODE IS WHAT ITS SUITES IMPORT DECLARES IT WITH `ci_imports`:
# every tracked file its entries reach in the module graph, an import of a
# type alone included, and every file under the directories it names that the
# graph holds no module for, so a fixture, a deletion or a file not yet
# resolved there still selects it. What a module reads by a path, the graph
# cannot see, and each such path is declared beside it. A graph that cannot be
# built or believed selects the gate on any change but a page's and keys it on
# the whole tree. A key on the graph is reused across trees that differ only
# outside it, so an input the declaration misses keeps vouching until the salt
# moves or `just check-full` runs the gate. A typed tool reads too what any
# file declares into every scope, which no import names: `ci_ambient`.
#
# A UNIT SUITE WHOSE GRAPH IS THE WHOLE OF WHAT IT LOADS IS DECLARED ON ITS
# OWN. `ci_unit_partition` asks the graph over the tree in hand which of the
# suites `check-source.sh --unit` runs are closed, as
# `.chug/tasks/_import-graph.sh` says what that is. A closed suite,
# `source-unit:<suite>`, reads what it reaches, where node looks from it, what
# every suite runs under, and for a `*.linux.test.ts` the worker image's node,
# and is selected and keyed on that; the open
# ones are `source-unit`, selected and keyed as the stage was whole. A graph
# that cannot be built or believed leaves every suite open.
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
# emitter's, the shell-quoting gate's and the console copy gate's run over the
# tree's own files, so their declarations hold their gate's, and the random
# replay's, which copies the sources and the tests, what its walk and its
# replay import of them.
#
# A GATE THAT READS NAMED PACKAGES FOLLOWS THEM, NOT THE PACKAGE FILES. Quint
# and the ticket package are all `check-model` takes from them, so the lock
# moving selects it only where the closure `.chug/tasks/_installed-inputs.sh`
# prints for them moved between the base and the tree, and a lock that cannot be read at either end
# selects. A gate that reads the whole install is selected by any change to
# the lock.

ci_select_init() {
	CI_SELECT_MODE=full
	CI_CHANGED_FILES=""
	CI_CHANGED_CODE=""
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
	CI_CHANGED_CODE="$(printf '%s\n' "$CI_CHANGED_FILES" | grep -v '\.md$' || true)"
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
	if [ "$CI_SELECT_MODE" = changed ] && ci_literal "$@"; then
		ci_changed_among "$CI_CHANGED_FILES" "$@"
		return
	fi
	ci_within="$(ci_changed_list "$@" 2>/dev/null)" || return 0
	[ -n "$ci_within" ]
}

# A pathspec with no magic and no wildcard matches the path it names and what
# is under it, so what it matches of the change already listed is what git
# would list for it, read without asking git again.
ci_literal() { # <pathspec>...
	[ "$#" -gt 0 ] || return 1
	for ci_spec do
		case "$ci_spec" in '' | :* | *[*?[\\]*) return 1 ;; esac
	done
}
ci_changed_among() { # <paths, one a line> <literal pathspec>...
	[ -n "$1" ] || return 1
	ci_among="$1"
	shift
	printf '%s\n' "$ci_among" | awk '
		BEGIN {
			for (i = 1; i < ARGC; i++) {
				spec = ARGV[i]
				sub(/\/+$/, "", spec)
				specs[i] = spec
				delete ARGV[i]
			}
		}
		{
			for (i in specs) {
				if (specs[i] == "." || $0 == specs[i] || index($0, specs[i] "/") == 1) { found = 1; exit }
			}
		}
		END { exit found ? 0 : 1 }' "$@"
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

# Every tracked file the entries import, by any path, and every file under the
# directories that is no module the graph holds, from the graph
# `.chug/tasks/_import-graph.sh` builds once a run over every directory and
# entry a declaration names, and its own inputs. A graph that cannot be built
# or believed, or that reaches a module git does not track, leaves the
# declaration reading the whole tree. Selecting on a change of pages alone
# builds none, since no page selects a code gate.
ci_imports() { # <directory>... -- <entry>...
	ci_imports_dirs=""
	ci_imports_entries=""
	ci_imports_into=dirs
	for ci_spec do
		if [ "$ci_spec" = "--" ]; then
			ci_imports_into=entries
		elif [ "$ci_imports_into" = dirs ]; then
			ci_imports_dirs="$ci_imports_dirs$ci_spec
"
		else
			ci_imports_entries="$ci_imports_entries$ci_spec
"
		fi
	done
	set -f
	# shellcheck disable=SC2086 # a path a word, by construction
	ci_graph_roots_add $ci_imports_dirs $ci_imports_entries
	set +f
	[ "${CI_GRAPH_COLLECTING:-0}" = 1 ] && return 0
	CI_INPUTS_WITHIN="$CI_INPUTS_WITHIN$ci_imports_dirs"
	ci_code .chug/tasks/_import-graph.sh .dependency-cruiser.cjs tsconfig.json
	ci_packages dependency-cruiser
	[ "${CI_INPUTS_SELECTING:-0}" = 1 ] && [ -z "$CI_CHANGED_CODE" ] && return 0
	if ci_imports_read; then
		CI_INPUTS_CODE="$CI_INPUTS_CODE$ci_imports_read"
	else
		CI_INPUTS_UNREAD="$ci_imports_why"
		ci_tree
		ci_code .
	fi
}

# A typed tool reads what a file declares into every other's scope: a file
# that holds `declare global` or `declare module`, or is named `*.d.ts`, at the
# base or now, wherever it is.
ci_ambient() {
	CI_INPUTS_AMBIENT=1
	if ! ci_ambient_held="$(
		git -c core.quotePath=false grep -l -E "$ci_ambient_declares" -- \
			'*.ts' '*.tsx' '*.mts' '*.cts' 2>/dev/null || [ "$?" = 1 ]
	)" || ! ci_ambient_typed="$(git -c core.quotePath=false ls-files -- '*.d.ts' 2>/dev/null)"; then
		ci_tree
		ci_code .
		return 0
	fi
	ci_ambient_held="$(printf '%s\n%s\n' "$ci_ambient_held" "$ci_ambient_typed" | sed '/^$/d' | sort -u)"
	[ -z "$ci_ambient_held" ] || CI_INPUTS_CODE="$CI_INPUTS_CODE$ci_ambient_held
"
}
ci_ambient_declares='declare[[:space:]]+(global|module)([^[:alnum:]_$]|$)'

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

# What every unit suite runs under: the runner's gate, its cap, the listing,
# the graph that says which suite is closed, the reporter that keeps each
# suite's outcome, and the root's tools.
ci_unit_harness() {
	ci_code .chug/tasks/check-source.sh .chug/tasks/_test-timeout.sh .chug/tasks/_unit-suites.sh \
		.chug/tasks/_import-graph.sh scripts/unit-outcomes.ts
	ci_toolchain
}

# The unit suites as $unit_suites, or a failure where none can be listed.
ci_unit_listed() {
	[ -r ./.chug/tasks/_unit-suites.sh ] || return 1
	. ./.chug/tasks/_unit-suites.sh
	unit_suites_list || return 1
	[ -n "$unit_suites" ]
}

# The graph is built over the directory at the root that holds each unit
# suite, or over the suite itself where the root does.
ci_unit_roots() {
	ci_unit_listed || return 0
	for ci_suite in $unit_suites; do
		ci_graph_roots_add "${ci_suite%%/*}"
	done
}

# The unit suites `check-source.sh --unit` runs, each closed or open, as
# $CI_UNIT_CLOSED and $CI_UNIT_OPEN, a path a line, read from the graph over
# the tree in hand. A graph that cannot be computed or believed leaves every
# suite open, and $CI_UNIT_WHY says why. Fails where git lists no unit suite.
ci_unit_partition() {
	CI_UNIT_CLOSED=""
	CI_UNIT_OPEN=""
	CI_UNIT_WHY=""
	ci_unit_listed || return 1
	CI_UNIT_OPEN="$unit_suites"
	ci_graph_build
	if [ "$CI_GRAPH_STATE" != built ]; then
		CI_UNIT_WHY="the import graph could not be computed: $CI_GRAPH_WHY"
		return 0
	fi
	ci_unit_answer="$CI_GRAPH_DIR/units"
	if [ ! -f "$ci_unit_answer/verdicts" ]; then
		rm -rf "$ci_unit_answer.part"
		if ! mkdir -p "$ci_unit_answer.part" ||
			! printf '%s\n' "$unit_suites" |
			ci_graph_ask suites "$CI_GRAPH_DIR/graph.json" "$ci_unit_answer.part" 2>"$ci_unit_answer.err" ||
			! mv "$ci_unit_answer.part" "$ci_unit_answer"; then
			CI_UNIT_WHY="the import graph cannot be believed: $(tail -n 1 "$ci_unit_answer.err" 2>/dev/null)"
			return 0
		fi
	fi
	CI_UNIT_CLOSED="$(awk -F '\t' '$1 == "closed" { print $2 }' "$ci_unit_answer/verdicts")"
	CI_UNIT_OPEN="$(awk -F '\t' '$1 == "open" { print $2 }' "$ci_unit_answer/verdicts")"
}

# What a gate or suite reads: $CI_INPUTS_CODE, $CI_INPUTS_TEXT and
# $CI_INPUTS_PROBES, a git pathspec a line; $CI_INPUTS_PACKAGES, a package a
# line; $CI_INPUTS_INSTALL, 1 for the whole install; $CI_INPUTS_TREE, 1 for a
# key on the whole tree; $CI_INPUTS_WITHIN, a directory a line under which a
# path the import graph holds no module for is read; $CI_INPUTS_AMBIENT, 1
# where what a file declares into every scope is read; and $CI_INPUTS_UNREAD,
# why an import graph asked for could not be read.
# A gate it does not name is read as text from the whole tree and keyed on it.
ci_inputs() { # <gate id or suite path>
	CI_INPUTS_CODE=""
	CI_INPUTS_TEXT=""
	CI_INPUTS_PROBES=""
	CI_INPUTS_PACKAGES=""
	CI_INPUTS_INSTALL=0
	CI_INPUTS_TREE=0
	CI_INPUTS_WITHIN=""
	CI_INPUTS_AMBIENT=0
	CI_INPUTS_UNREAD=""
	ci_declare "$1"
}

ci_declare() { # <gate id or suite path>
	case "$1" in
	doc-lint | check-figures | check-paths | check-shell-quoting | check-console-sheets | \
		check-gates | check-comments)
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
	check-agent-lag)
		ci_code images/worker .chug/tasks/check-agent-lag.sh
		;;
	check-boundaries)
		ci_tree
		ci_code src test scripts ui .chug/tasks/check-boundaries.sh
		ci_toolchain
		;;
	source-unit)
		[ "${CI_GRAPH_COLLECTING:-0}" != 1 ] || ci_unit_roots
		ci_tree
		ci_code src test ui images scripts deploy model .chug/configurations \
			.chug/workloads .chug/actions tsconfig.contract.json tsconfig.contract-pack.json \
			.chug/tasks/check-console-sheets.sh
		ci_text deploy/rig/images/README.md .chug/actions/README.md .chug/prompts \
			.chug/tasks/review-change.md
		ci_unit_harness
		;;
	source-unit:*)
		if ci_unit_reached="$(cat "${CI_GRAPH_DIR:-}/units/reach/${1#source-unit:}" 2>/dev/null)" &&
			[ -n "$ci_unit_reached" ]; then
			CI_INPUTS_CODE="$CI_INPUTS_CODE$ci_unit_reached
"
			# shellcheck disable=SC2046 # a directory a word, by construction
			ci_node_looks $(printf '%s\n' "$ci_unit_reached" |
				awk -F/ '{ d = $1; for (i = 2; i < NF; i++) { print d; d = d "/" $i } if (NF > 1) print d }' |
				sort -u)
			ci_unit_harness
			# Off Linux, check-source runs this suite in the node the worker image pins.
			case "$1" in *.linux.test.ts) ci_code images/worker/Dockerfile ;; esac
		else
			ci_declare source-unit
		fi
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
	check-console-copy)
		ci_code ui/chuggy-ui/app/copy ui/chuggy-ui/app/core/generated \
			ui/chuggy-ui/tools/copyCatalog.ts .chug/tasks/check-console-copy.sh
		ci_node_looks ui/chuggy-ui/tools ui/chuggy-ui
		ci_manifests
		ci_packages @fluent/syntax
		;;
	check-conformance)
		ci_code src/domain src/generated test/conformance test/domain test/itf test/golden \
			model .chug/tasks/check-conformance.sh
		ci_node_looks src
		ci_manifests
		ci_packages zod @kasofsk/chug-ticket-domain
		;;
	check-random)
		ci_code src/domain src/generated test/random test/conformance test/domain test/itf \
			model .chug/tasks/check-random.sh
		ci_node_looks src
		ci_manifests
		ci_packages zod @kasofsk/chug-ticket-domain
		;;
	check-postgres)
		ci_imports src test -- 'test/postgres/*.test.ts' .chug/tasks/postgres-databases.ts \
			src/roots/migrate.ts src/roots/provisionAgentSession.ts src/roots/provisionProjectAccess.ts \
			src/roots/nativeHttp.ts src/roots/controlPlane.ts src/adapters/postgres/pool.ts \
			test/postgres/schedulerRootPorts.ts
		ci_code deploy/rig/wipe-tickets.sql src/roots/runnerReleases.json test/fixtures/fluxDeliveries \
			package.json .chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts \
			.chug/tasks/check-postgres.sh .chug/tasks/_test-timeout.sh
		ci_node_looks .chug/tasks .chug
		ci_install
		;;
	check-queries)
		ci_imports src test scripts -- src/adapters/postgres src/roots/migrate.ts \
			.chug/tasks/postgres-databases.ts
		ci_ambient
		ci_code package.json tsconfig.json eslint.config.js \
			.chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts .chug/tasks/check-queries.sh
		ci_probes ':(glob)eslint.config.*' .eslintignore .eslintcache eslint-suppressions.json
		ci_node_looks .chug/tasks .chug
		ci_install
		;;
	check-keto)
		ci_imports src test -- 'test/keto/*.test.ts' .chug/tasks/postgres-databases.ts \
			src/roots/provisionAccessDefaults.ts src/roots/provisionProjectAccess.ts \
			src/roots/provisionAgentSession.ts
		ci_code .chug/tasks/keto package.json .chug/tasks/_keto.sh \
			.chug/tasks/_postgres.sh .chug/tasks/postgres-databases.ts .chug/tasks/check-keto.sh \
			.chug/tasks/_test-timeout.sh
		ci_node_looks .chug/tasks .chug
		ci_install
		;;
	check-model)
		ci_code ':(glob)model/**/*.qnt' .chug/tasks/check-model.sh
		ci_packages @informalsystems/quint @kasofsk/chug-ticket-domain
		;;
	check-model-api)
		ci_code ':(glob)model/**/*.qnt' scripts/generate-model-api.ts src/generated \
			src/domain/generated .chug/tasks/check-model-api.sh
		ci_node_looks scripts
		ci_manifests
		ci_packages @informalsystems/quint prettier @kasofsk/chug-ticket-domain
		;;
	.chug/tasks/ci.test.sh)
		ci_code "$1" .chug/tasks/ci.sh .chug/tasks/_ci-select.sh .chug/tasks/_import-graph.sh \
			.chug/tasks/_ignored-inputs.sh .chug/tasks/_installed-inputs.sh .chug/tasks/_probed-inputs.sh \
			.chug/tasks/_suite.sh .chug/tasks/_unit-suites.sh .chug/tasks/check-source.sh \
			.chug/tasks/_test-timeout.sh scripts/unit-outcomes.ts .dependency-cruiser.cjs tsconfig.json \
			justfile package.json
		ci_packages dependency-cruiser
		;;
	.chug/tasks/check-source.test.sh)
		ci_code "$1" .chug/tasks/check-source.sh .chug/tasks/_test-timeout.sh .chug/tasks/_suite.sh \
			.chug/tasks/_unit-suites.sh scripts/unit-outcomes.ts tsconfig.json tsconfig.contract.json \
			eslint.config.js .prettierrc.json .prettierignore package.json
		ci_install
		;;
	.chug/tasks/check-console.test.sh)
		ci_code "$1" .chug/tasks/check-console.sh .chug/tasks/_suite.sh
		ci_packages eslint
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
		.chug/tasks/check-shell-quoting.test.sh | .chug/tasks/check-console-copy.test.sh)
		ci_suite_over="${1##*/}"
		ci_code "$1" .chug/tasks/_suite.sh
		ci_declare "${ci_suite_over%.test.sh}"
		;;
	.chug/tasks/check-random.test.sh)
		ci_code "$1" .chug/tasks/_suite.sh .chug/tasks/check-conformance.sh
		ci_imports src test -- 'test/random/*.test.ts' 'test/conformance/*.test.ts'
		ci_declare check-random
		;;
	.chug/tasks/emit-goldens.test.sh)
		ci_code "$1" .chug/tasks/emit-goldens.sh .chug/tasks/_suite.sh .gitignore .prettierignore
		ci_packages prettier
		ci_declare check-model
		;;
	.chug/tasks/check-keto.test.sh)
		ci_code "$1" .chug/tasks/check-keto.sh .chug/tasks/_keto.sh .chug/tasks/_postgres.sh \
			.chug/tasks/_gate-fixture.sh .chug/tasks/_suite.sh .chug/tasks/keto .chug/tasks/_test-timeout.sh
		;;
	.chug/tasks/check-postgres.test.sh)
		ci_code "$1" "${1%.test.sh}.sh" .chug/tasks/_postgres.sh .chug/tasks/_gate-fixture.sh \
			.chug/tasks/_suite.sh .chug/tasks/_test-timeout.sh
		;;
	.chug/tasks/check-queries.test.sh)
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
	CI_INPUTS_SELECTING=1
	ci_inputs "$1"
	CI_INPUTS_SELECTING=0
	ci_changed_listed "$CI_INPUTS_TEXT" ||
		ci_changed_listed "$CI_INPUTS_CODE" ':(exclude)*.md' ||
		ci_changed_listed "$CI_INPUTS_PROBES" ||
		ci_packages_moved ||
		ci_changed_unheld ||
		ci_changed_ambient
}

# The graph, built once: over every directory and entry a declaration names,
# where ci.sh has asked each declaration with `ci_graph_roster`, and over the
# ones asked so far otherwise. `$CI_GRAPH_DIR` holds it and the answers read
# from it, or a directory of its own is made.
CI_GRAPH_STATE=""
CI_GRAPH_ROOTS=""
ci_graph_roots_add() { # <directory or entry>...
	for ci_root do
		case "$ci_root" in */*\**) ci_root="${ci_root%/*}" ;; esac
		case "
$CI_GRAPH_ROOTS" in *"
$ci_root
"*) ;; *) CI_GRAPH_ROOTS="$CI_GRAPH_ROOTS$ci_root
" ;; esac
	done
}
ci_graph_roster() { # <gate id or suite path>...
	CI_GRAPH_COLLECTING=1
	for ci_id do ci_inputs "$ci_id"; done
	CI_GRAPH_COLLECTING=0
}
# What became of the build is read off the files it leaves, so a declaration
# asked inside a command substitution builds nothing a second time.
ci_graph_build() {
	[ -z "$CI_GRAPH_STATE" ] || return 0
	CI_GRAPH_STATE=failed
	CI_GRAPH_WHY="no directory for it could be made"
	if [ -z "${CI_GRAPH_DIR:-}" ]; then
		CI_GRAPH_DIR="$(mktemp -d 2>/dev/null)" || return 0
	fi
	mkdir -p "$CI_GRAPH_DIR" 2>/dev/null || return 0
	if [ ! -f "$CI_GRAPH_DIR/graph.json" ] && [ ! -f "$CI_GRAPH_DIR/graph.err" ]; then
		set --
		for ci_root in $CI_GRAPH_ROOTS; do
			[ ! -e "$ci_root" ] || set -- "$@" "$ci_root"
		done
		if sh .chug/tasks/_import-graph.sh build "$CI_GRAPH_DIR/graph.part" "$@" \
			2>"$CI_GRAPH_DIR/graph.err"; then
			mv "$CI_GRAPH_DIR/graph.part" "$CI_GRAPH_DIR/graph.json" && rm -f "$CI_GRAPH_DIR/graph.err"
		fi
	fi
	if [ -f "$CI_GRAPH_DIR/graph.json" ]; then
		CI_GRAPH_STATE=built
	else
		CI_GRAPH_WHY="$(tail -n 1 "$CI_GRAPH_DIR/graph.err" 2>/dev/null)"
	fi
}

ci_graph_ask() { sh .chug/tasks/_import-graph.sh "$@"; }

# What `ci_imports` adds for the directories and entries in hand, as
# $ci_imports_read, a path a line, or why there is none, as $ci_imports_why.
# Each answer is kept beside the graph, so asking again reads no graph.
ci_imports_read() {
	ci_graph_build
	if [ "$CI_GRAPH_STATE" != built ]; then
		ci_imports_why="the import graph could not be computed: $CI_GRAPH_WHY"
		return 1
	fi
	ci_imports_key="$(printf '%s--\n%s' "$ci_imports_dirs" "$ci_imports_entries" | cksum | tr ' ' '-')"
	ci_imports_answer="$CI_GRAPH_DIR/inputs.$ci_imports_key"
	if [ ! -f "$ci_imports_answer" ]; then
		ci_graph="$CI_GRAPH_DIR/graph.json"
		set -f
		# shellcheck disable=SC2086 # a path a word, by construction
		if ! ci_reach="$(ci_graph_ask reach "$ci_graph" $ci_imports_entries 2>"$ci_imports_answer.err")"; then
			set +f
			ci_imports_why="the import graph cannot be believed: $(tail -n 1 "$ci_imports_answer.err")"
			return 1
		fi
		ci_untracked="$(printf '%s\n' "$ci_reach" | ci_graph_ask holds "$ci_graph" --untracked)" &&
			# shellcheck disable=SC2086 # a path a word, by construction
			ci_unheld="$(git -c core.quotePath=false ls-files -- $ci_imports_dirs ':(exclude)*.md' |
				ci_graph_ask holds "$ci_graph" --not)" || {
			set +f
			ci_imports_why="the import graph could not be read"
			return 1
		}
		set +f
		if [ -n "$ci_untracked" ]; then
			ci_imports_why="the import graph reaches $(printf '%s\n' "$ci_untracked" | head -n 1), which git does not track"
			return 1
		fi
		printf '%s\n%s\n' "$ci_reach" "$ci_unheld" | sed '/^$/d' | sort -u >"$ci_imports_answer.part" &&
			mv "$ci_imports_answer.part" "$ci_imports_answer" || {
			ci_imports_why="the import graph's answer could not be kept"
			return 1
		}
	fi
	ci_imports_read="$(cat "$ci_imports_answer")
"
}

# Whether the change holds a path, other than a page, under a directory a
# graph declaration names that the graph holds no module for: a file deleted,
# one not yet tracked, or one no import names.
ci_changed_unheld() {
	[ -n "$CI_INPUTS_WITHIN" ] && [ -n "$CI_CHANGED_CODE" ] && [ -z "$CI_INPUTS_UNREAD" ] || return 1
	ci_unheld_changed="$(printf '%s\n' "$CI_CHANGED_FILES" | grep -v '\.md$' | while IFS= read -r ci_path; do
		for ci_dir in $CI_INPUTS_WITHIN; do
			case "$ci_path" in "$ci_dir"/*)
				printf '%s\n' "$ci_path"
				break
				;;
			esac
		done
	done | ci_graph_ask holds "$CI_GRAPH_DIR/graph.json" --not)" || return 0
	[ -n "$ci_unheld_changed" ]
}

# Whether the change holds a file that declares into every scope, at the base
# or now, for a declaration that reads one.
ci_changed_ambient() {
	[ "$CI_INPUTS_AMBIENT" = 1 ] || return 1
	ci_ambient_changed="$(printf '%s\n' "$CI_CHANGED_FILES" | while IFS= read -r ci_path; do
		case "$ci_path" in
		*.d.ts) printf '%s\n' "$ci_path" ;;
		*.ts | *.tsx | *.mts | *.cts)
			if { [ -f "$ci_path" ] && grep -qE "$ci_ambient_declares" "$ci_path"; } ||
				git show "$CI_MERGE_BASE:$ci_path" 2>/dev/null | grep -qE "$ci_ambient_declares"; then
				printf '%s\n' "$ci_path"
			fi
			;;
		esac
	done)"
	[ -n "$ci_ambient_changed" ]
}

# Whether the change touched what a list of pathspecs, one a line, matches,
# less the pages where the exclusion of them is given beside it; an empty list
# matches nothing.
ci_changed_listed() { # <pathspecs, one a line> [':(exclude)*.md']
	[ -n "$1" ] || return 1
	ci_listed="$1"
	ci_narrowed="${2:-}"
	set -f
	IFS='
'
	# shellcheck disable=SC2086 # a pathspec a line, by construction
	set -- $ci_listed
	unset IFS
	set +f
	if [ "$ci_narrowed" = ':(exclude)*.md' ] && [ "$CI_SELECT_MODE" = changed ] && ci_literal "$@"; then
		ci_changed_among "$CI_CHANGED_CODE" "$@"
		return
	fi
	[ -z "$ci_narrowed" ] || set -- "$@" "$ci_narrowed"
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
