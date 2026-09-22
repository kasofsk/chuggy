---
name: chuggy-false-reds
description: "The roster of environmental gate reds on chuggy on this box — attribute a red by name before believing it, and never blame the branch first"
metadata:
  type: project
---

Every red below is the box, not the branch. Attribute by name before filing or
bisecting; exit 2 is a could-not-run and never a pass.

**Standing prefixes for every builder/reviewer/lander brief:** Node 24 on PATH
(the tree runs `node --experimental-strip-types` everywhere — an older node
cannot run a gate at all), `TMPDIR=/tmp`, `FORCE_COLOR=0 NO_COLOR=1`.

**check-model / check-random**
- **Colour (exit 1, 13 phantom failures).** Claude Code exports `FORCE_COLOR=3`;
  quint emits ANSI even into `$(...)`, the gate's `sed` pass-count match fails,
  and every suite reads as "selected no tests". Bare run: 13 failures / 0 tests.
  Colour-neutralised: 0 / 85.
- **Memory or swap pressure (exit 2, SIGSEGV 139 or SIGILL 132).** The
  randomized-invariants stage dies when other agents load the box. Run
  `check-model` **alone**, which is also why it is the natural last gate.
- **A dead test child reads as a finding.** Node's runner starts children with
  `--test-timeout=0` and the `dot` reporter drops `test:stderr`, so a child that
  dies shows as bare `'test failed'` with no seed or assertion text and the gate
  calls it exit 1. Same shape in check-conformance, check-source and
  check-postgres (issue filed). **A bare `'test failed'` with no seed is a dead
  child: rerun once.** Two live variants: a lone witness exiting on
  `ERR_UNHANDLED_REJECTION … "undefined"` (rerun that witness alone —
  `npx quint test --match 'Witness$' --main=<witness> model/tests/…`), and
  `check-random` sitting at full CPU for thirteen minutes against a one-second
  gate when another agent runs `ci.sh` concurrently. Cap the full gate with
  `timeout 540` and never run two gate runs on the box at once.
- **Parallel `*.test.sh` suites.** `ci.sh` runs them concurrently under a 60s /
  120s cap; the quint-invoking ones are contention-sensitive and a suite can
  return rc=1 while the gate it tests passes in that same run. Four full runs
  went 0, 2, 1, 0 with no code change.

**postgres**
- One shared `chuggy-check-postgres` container across agents gives
  `tuple concurrently updated` (`XX000`, role catalogs are cluster-wide, ~1 run
  in 3 on `migration.test.ts`, #342) and `57014 statement timeout`. **The fix
  that worked: one `postgres:18-alpine` per agent** (`chuggy-check-postgres-<n>`,
  ports 55433+) via `CHUG_PG_URL`, and nothing else running beside the gate.
- **`check-queries` migrates the database in place**, so a second run against
  the same database is exit 2. Give each run a fresh `CREATE DATABASE` — also
  the remedy for "column … already exists" after renumbering a migration.

**check-source and friends**
- `TMPDIR` unset → `ticketService.test.ts` "parses its complete plain-data
  configuration" fails (#334). `claude` off PATH (`/home/geoff/.local/bin`) →
  `check-roster` exit 2. `ci.test.sh` greps `Justfile`, the file is `justfile`
  (#313).
- `httpClient.test.ts` deadline cases and `httpServer.test.ts` go red inside a
  loaded unit run and pass alone (#345).
- `model-api-generator.test.ts` → `spawnSync … ENOBUFS`: FIXED at chuggy
  3be38c30 (2026-09-10, #636): the fixture no longer captures quint's stdout.
  A worktree older than that still shows it (quint writes the IR to stdout
  beside `--out`; Node truncates a piped stdout at exit, so load decides how
  much reaches the 1 MiB `maxBuffer`). It refused a release's phase 1 once.
- **`npm ci` only ever at the root.** `ui/chuggy-ui` is a workspace with no lock
  of its own; `npm ci` there wipes `@informalsystems/quint` and check-source
  false-reds on `quint ENOENT`. A worktree predating #344 needs a fresh root
  `npm ci` or `check-boundaries`/`check-console` fire on `react` and `vitest`.

**What no gate covers:** `ci.sh` never builds the worker image, so a PR touching
`images/worker/` can pass everything and fail `docker build`. Landers build it
by hand when that path moved.

**Attribute at the real base.** A red from a branch off a stale `main` lineage
may be main's old state (#331 was exactly this). Stash and re-run on the base
before believing anything. Related: [[guards-fail-open]],
[[sibling-pr-integration-gate]].

**Migration red-proofs (2026-09-11):** `test/postgres/harness.ts` does not
migrate; `check-postgres.sh` prepares one template database and clones it
per suite. A postgres suite run by hand against an already-migrated server
cannot see a migration change, so a mutation of a migration comes back
GREEN falsely. Red-proof a migration by preparing a fresh database from the
mutated chain (`.chug/tasks/postgres-databases.ts prepare`) or by running
`check-postgres.sh` whole. See [[guards-fail-open]].

- **check-random draws a bad seed** (2026-09-11): about one run in five raises
  `ticket id: 0 is below the first id` from `src/domain/ids.ts` on an untouched
  base; `git diff origin/main -- src/domain test/domain test/random src/contract`
  empty means it is the base's flake — rerun, don't file against the branch.
- **check-model quint witness `ERR_UNHANDLED_REJECTION`** once, clean on rerun
  (same day); joins the earlier intermittent segfault.

**check-model SIGSEGV (2026-09-13):** the quint stages segfaulted at ~50% of runs on an idle box (47 GB free, no swap), a different stage each time (typecheck, witnesses, refinement), inside ci.sh AND standalone — so "run check-model alone" is no longer a reliable mitigation; rerunning is. A violated property is reported, never a SIGSEGV, so exit 139 is environmental. Also seen the same day: a shell-suite self-test (check-boundaries.test.sh, check-random.test.sh) red under parallel suites, 3/3 green standalone; and `tuple concurrently updated` whenever another session migrates databases on the same cluster — move to the second container (chuggy-check-postgres-step5, 55435) instead of retrying.

- 2026-09-21: `check-model-api.test.sh` rc=1 inside a full `deploy-to-gtr.sh` run while a subagent ran gates in another worktree; 4/4 green standalone a minute later. Attribute by rerunning the suite alone before filing.

- 2026-09-22: **shell-suite budget red from orphaned test children.** `ci: BUDGET REACHED` (suites 156s against the 120s cap) with every gate clean; the box sat at load 19 because fourteen `node --test` children from removed reviewer/sweep worktrees kept spinning at 100% CPU for over an hour, reparented to `systemd --user` with a deleted cwd. Find them with `ps -eo pid,args | grep -- --test-con` and `readlink /proc/<pid>/cwd` reading `(deleted)`; kill those and rerun. Reviewers that remove their worktree while a suite still runs leave these behind, so a full roster after a review round should check the load first.

- 2026-09-22: `migration.test.ts` "the two reason rosters admit the escalation and refuse a name neither has" red about one run in three was NOT the box: two refused inserts fired concurrently with the second rejection handler attached late (unhandled rejection kills the child). Fixed in #733 (main 02bd9572). The signature — a `native_action_reason_check` violation printed as the failure of a case that expects that very refusal — is a late-attached handler, and any case that starts two rejecting promises before awaiting either has it.
