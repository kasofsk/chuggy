# Review round 2 — fix/cascade-rows-replay @ b5d30cd1

APPROVE

Read the four commits whole, then `src/actor/decisionSemantics.ts`,
`src/actor/journal.ts`, `src/actor/equality.ts`, `src/domain/deciders.ts`,
`src/domain/enablement.ts`, `src/domain/core.ts`, 005 whole and both suites.
Traced the rig's shape by hand through `decideRevoke` → the correction →
`recordEquals`, then confirmed each trace with probes run from the scratchpad
against the worktree's modules. No findings.

The one thing round 1 could not do, and this round did: **the deleted decider
is still in the history**, at `d3128929^:src/domain/deciders.ts`, and it settles
every question the brief asks by reading rather than by inference.

```ts
const doomed = new Set<TicketId>([id]);
for (let round = 0; round < config.nTickets; round++)
  for (const k of ticketIds(core))
    if ([...ticketAt(core, k).deps].some((d) => doomed.has(d as TicketId))) doomed.add(k);
const parked = ticketIds(core).filter(
  (k) => k !== id && doomed.has(k) && ticketAt(core, k).phase === "Pending",
);
```

with `transitions = [{id, from: phase, to: "Revoked"}, ...parked → Escalated]`,
`effects = ["CancelTicketWork", ...parked.map(() => "OpenHumanTask")]`, and each
park written `{...ticketAt(core,k), phase: "Escalated", reason: "DependencyRevoked"}`
— `resumeAt` untouched, so `"NoResume"`, and no `retireLive`, which is a no-op
on a Pending ticket anyway. Its own header reads: *"Parking only Pending
dependents is exhaustive, because dispatch needs every dependency Done and Done
absorbs."*

Against that source, `decisionSemantics.ts:181-189` is the old filter exactly:
Pending-only, each ticket once (`ticketIds` is unique), in record order (the old
list is ascending id, which every genuine row carries). `from` is `"Pending"` by
construction and now equals the old `from` by construction. The park's post-state
differs from the old machine's in `reason` alone, which is the divergence GOAL
asked for. So nothing the old machine wrote is newly refused, and the three
forgeries round 1 named are closed.

## Round-2 questions, answered

**The three forgeries.** Re-derived each by hand and re-ran them: a park of a
ticket already `Revoked`, one already `Working`, and the same dependent twice all
drop out of `parked` (the first two are not in `pending`, the third is deduped),
so the re-derived record is shorter than the stored one and `recordEquals`
refuses. A ticket the fleet never held is filtered before `ticketAt`, so it
refuses rather than throws — the property the fourth case holds.

**Nothing rig-shaped newly refused.** Probed, all `LEGAL` at semantics 2 and
`REFUSED` at 4: the plain two-dependent cascade (also legal at 1 and 3), a
**transitive** cascade (3 deps 2 deps 1, revoke 1 parks both), and a cascade off
a `Working` revoked ticket. The transitive case is the one that matters — the old
`doomed` set is a closure, so a stricter *direct*-dependent check would have
refused real rig rows. This change correctly adds none.

**The Pending argument in the doc comment.** The conclusion is right; the reason
as stated is a little short. A Pending ticket also leaves Pending by its own
`Revoke`, and under the old machine by an earlier cascade's park — neither is
"once its dependencies are Done". In both cases the cascade would not have parked
it either (it filtered on `phase === "Pending"`), so the restriction is still
exactly the old filter, and the sentence is the deleted decider's own argument
carried forward in its own words. Not worth a rewrite; a reader who follows it
reaches the true conclusion.

## Notes — checked and not flagged

- **What the check still admits.** A record may park a Pending ticket that is not
  in the revoked ticket's `doomed` closure, or name only a subset of the doomed
  Pending set; both probe `LEGAL`. Not a finding: a journal writer who can forge
  that row can already write a plain `Revoke` of that same ticket, which is legal
  by construction and settles it outright, so the forgery buys nothing — and the
  resulting state is the one a genuine park produces, unlike round 1's cases,
  which resurrected a settled ticket or built a `Working` ticket with live tasks
  never retired. The line the fix drew is the right one: it closes exactly the
  cases that reach a state no machine could.
- **`deskConsistent`.** A replayed parked dependent is `Escalated` /
  `NoReason` / `NoResume`, which `src/domain/invariants.ts:81` calls impossible
  (the old machine's park failed its second conjunct too). Nothing breaks: only
  `test/conformance/` and `test/random/` evaluate the bundle, always over traces
  the current deciders emit, never over a replayed legacy journal — `src/` imports
  only the `StepView` type. And 005's surviving `ticket_projection` arm is what
  keeps it out of a migrated database: a dependent still in the park would hold a
  projection row at `DependencyRevoked`, and the guard raises on one.
- **005.** The remaining arms are `ticket_projection`, `native_action` Open,
  `session_turn` length and the journal's three field reads; the parens balance
  and no arm reads `rec`. The new header paragraph is true of the body, and the
  cascade's event (`{"type":"Revoke","value":<int>}`) reaches
  `->'value'->>'reason'` as NULL, so the surviving `DependencyRevoked` arm cannot
  match one. `migration.test.ts` moves the cascade row into `undeletedRows`, so
  "a row each arm must not match migrates" now seeds it and asserts 005 applies:
  the admission is proved, not asserted. The plain single-transition revoke lost
  its near-miss row, which is right — no arm looks at revoke transitions any more.
- **Docs.** `check-comments`, `check-figures` and `check-paths` all exit 0 (0
  findings). No figure a reader must trust; the rig's row counts stay in the
  commit messages, where house rule 12 puts them. The in-place edit of a landed
  migration carries its condition in its own commit message, which is what the
  `migrations-edited-in-place` trap asks for.
- **Ran, not read:** `tsc --noEmit` 0, `node --test test/actor/decisionSemantics.test.ts`
  16/16, `eslint` and `prettier --check` clean on the four touched files.
  `check-postgres` and `check-queries` need a server and were not run; nothing in
  the SQL edit looks like it would move either.
- **Carried forward from round 1, still outside this diff.** `revocableIn` refuses
  `Finalizing`, and that exclusion arrived with `3f3fc14d the domain and the actor
  lose the handoff vocabulary` — after the semantics 1/2 rows were written. If any
  of the nine rig rows revokes a ticket in a phase that machine had and this one
  does not, it is refused at `decisionEventEnabled` before any of this runs. A
  `SELECT` over the rig's journal before the next release attempt would settle it.
- Worktree left clean at b5d30cd1; every probe ran from the scratchpad.

Practices invoked: `domain-modelling@blessed-practices` — "make illegal states
unrepresentable". The correction now refuses on the one axis where admitting
would build an unreachable ticket, which is what round 1 asked of it.
