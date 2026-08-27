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
there because three of the drills act on the cluster rather than on the console.
`CHUG_RIG_EVIDENCE_DIR` is where the screenshots and traces are written; it
defaults to a directory under the system temporary one, and it is never inside
this tree.

The browsers are a separate download and are installed once:

```sh
npx playwright install chromium
```

## What each drill claims

- `creation.spec.ts` — a ticket created from the form reaches a project table in
  a tab that was opened once and never navigated again, and so does the
  transition that follows it. What a selector dispatches is reported rather than
  required.
- `escalation.spec.ts` — revoking a ticket another depends on escalates the
  second; the shell's badge and the inbox row both move without a reload, and
  answering the row clears both the same way.
- `listener.spec.ts` — the API's `LISTEN` backend is terminated repeatedly for a
  named window; the console says it is not live, keeps reading on its bounded
  fallback, and converges once the listener returns.
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

Two drills need the journalled actor up, because releasing a draft is its work
and no console action can settle a release without it; they say so and skip when
it is not. **A skip is not a pass.** The other three need only the API: they
create and revise a draft, which is the change the API appends to the durable log
on its own, so a stream is exercised without the rest of the installation being
involved in whether it worked.

## What it costs to run

`listener.spec.ts` terminates the process's doorbell connection and
`restart.spec.ts` restarts the API. Both are recoverable and both are the point,
but they are real, so this suite is asked for by name and never swept into a gate
run.
