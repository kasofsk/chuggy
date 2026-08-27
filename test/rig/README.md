# The rig acceptance drills

A browser suite that drives a deployed console the way a person does: a real
Chromium, a real sign-in through the issuer, and a real cluster underneath it.
Nothing here is a double, and nothing here runs in `.chug/tasks/ci.sh` or in the
hook — it needs a running installation and an identity that may act on one of its
projects, and a gate that cannot reach either would report a could-not-run on
every desk.

```sh
just acceptance                     # every drill
just acceptance listener.spec.ts    # one of them
```

`just acceptance` requires `CHUG_RIG_CONSOLE_URL`, `CHUG_RIG_API_URL`,
`CHUG_RIG_USER`, `CHUG_RIG_PASSWORD`, `CHUG_RIG_TENANT`, `CHUG_RIG_PROJECT` and
`CHUG_RIG_SSH`, and exits 2 naming the ones it did not get. `CHUG_RIG_SSH` is
there because most of the drills ask the cluster something or act on it.
`CHUG_RIG_EVIDENCE_DIR` is where the screenshots, the traces and the run's JSON
report are written; it defaults to a directory under the system temporary one,
and it is never inside this tree.

The browsers are a separate download and are installed once:

```sh
npx playwright install chromium
```

## The runner's exit is not the verdict

Playwright exits zero on a run whose drills all skipped, and prints no reason.
So `just acceptance` reads the report back through `test/rig/verdict.ts` and
exits 2 — the same could-not-run every gate in this tree gives — when any drill
did not run, naming each one and what it said. It does the same for a drill that
could not ask the cluster at all: `onRig` marks a failed command, so a wrong ssh
destination or a denied role is a could-not-run rather than a benign
precondition.

## What each drill claims

- `creation.spec.ts` — two drills. A ticket created from the form reaches a
  project table in a tab that was opened once and never navigated again, and so
  does the transition that follows it; separately, a dispatched ticket's
  execution appears with its status. The second needs a selector at more than no
  replicas and says so.
- `escalation.spec.ts` — revoking a ticket another depends on escalates the
  second; the shell's badge and the inbox row both move without a reload, and
  answering the row clears both the same way.
- `listener.spec.ts` — two drills. The API's `LISTEN` backend is terminated
  repeatedly across a window; the console says the change log behind its stream
  is degraded and converges once the listener returns. Separately, a console
  whose stream requests are refused reads on its bounded fallback: the change is
  drawn while the banner is still up, inside a bound derived from the fallback's
  own interval. The two halves induce the same `degraded` state through its two
  different causes, and the spec's header says why the second cannot be built on
  the first.
- `restart.spec.ts` — the API deployment is restarted under an open stream and a
  draft is revised across the rollout; the console reconnects and ends up drawing
  it.
- `capacity.spec.ts` — more event streams are held open than the API admits
  ordinary requests at once; an ordinary read still answers and the console keeps
  drawing live changes.

## What the drills need of the installation

The identity needs `Read` and `Mutate` on the project, granted with
`npm run provision:project-access` — the principal is derived from the issuer and
the subject the token carries, so an operator supplies those and never types a
principal. The project needs one ready configuration revision for a draft to be
shaped by.

Three drills need the journalled actor up, because releasing a draft is its work
and no console action can settle a release without it; one of those also needs
the selector, because dispatch is the selector's. The rest need only the API:
they create, revise and delete a draft, which is the change the API appends to
the durable log on its own, so a stream is exercised without the rest of the
installation being involved in whether it worked.

## What it costs to run, and what it leaves

`listener.spec.ts` terminates the process's doorbell connection and
`restart.spec.ts` restarts the API. Both are recoverable and both are the point,
but they are real, so this suite is asked for by name and never swept into a gate
run.

What a run leaves behind:

- **Every ticket it created, revoked.** Drills that release a ticket revoke it
  before they finish, so they accumulate as revoked rows rather than as work.
- **No open drafts.** Each drill that creates one deletes it through the wire's
  own `DELETE`, which leaves a draft in its deleted state rather than removing
  the row. A drill that fails part way leaves its draft open, and that is the
  one residue a failed run has.
- **The project's configuration revision is not this suite's.** It has to be
  there before a run and is left alone.

Everything a run writes carries the same intent prefix — `rig acceptance` — so
what a failed run left can be found by reading intents rather than by guessing at
ticket numbers.
