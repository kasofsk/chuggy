# Review, round 3 — `model/rename` 9ab90d02..e32deb65

APPROVE

Reviewed in `~/claude/chuggy-wt/rename-r3`, detached at `e32deb65`, fresh
session, authored none of it. Every mutation below was applied one at a time
and reverted with `git checkout --`; the tree is clean at `e32deb65` and
nothing was committed.

## 1. The frozen semantics-4 journal

**It was written by main's code, not by hand.** I re-extracted `src/` from
`55de9de6` into my own scratch tree (byte-identical to the snapshot the report
used), re-ran the recipe against it, and the 28 rows it printed are the
committed file: semantically identical to `JSON.parse`, and byte-identical
after `prettier --parser json`. The generator throws unless
`decisionEventEnabled` admits each event, so every row is one main's machine
could have taken.

**Every spelling the map lifts is at a path the lift walks.** I decoded the
fixture and located each key by JSON path: `ReleaseTicket` at `.event.type`;
`Working`/`Evaluating`/`Finalizing` at `.rec.transitions[].from|.to`; the five
walls at `.event.value.reason`; `FinalizationFailed` at `.event.value.out`; the
four step labels at `.rec.label`. Nothing is present only as incidental text.
`WorkFailed` and `ReworkBudgetExhausted` are absent, and the excuse holds: on
main, `reason` occurs in exactly one journaled event (`ExecutionBlocked`,
`model-api.ts:522-524`) and `executionBlockedReasons`
(`enablement.ts:175`) admits the five walls alone.

**The test is derived from the map, not a copy.** `supersededSpellings` is
`[...currentVocabulary.keys()]`, exported at `src/actor/decisionSemantics.ts:129`.

**Red-proofs I ran myself** (all from a green baseline of 20/20 in
`test/actor/decisionSemantics.test.ts`):

| Mutation | Result |
|---|---|
| each of the 16 keys dropped from `currentVocabulary`, one at a time | all 16 redden. Eleven refuse the bytes in `pinned()`; `ticket-escalated work_failed`, `execution_blocked` and `rework-started finalization_failed` fail `the vocabulary history is legal…`; `WorkFailed` and `ReworkBudgetExhausted` fail `every superseded spelling…` via the map's own answer |
| `Finalizing` specifically | red — `journalAtSemanticsFour.json` row 23 unreadable |
| `event.value.out` left unlifted in `rowAtCurrentVocabulary` | **red** — row 24 unreadable. This closes sweep unpinned §2 |
| drop the one `RuntimeVersionUnsupported` row from the fixture | red, exactly `no pinned row says RuntimeVersionUnsupported`, plus the legality case |
| one byte of a transition (`Finalizing`→`Finalizinh`) | red at `rec.transitions[0].to` |

`storedJournalLegalOn` passes on the journal at semantics 4 and bites when the
bytes move (row-drop case above).

## 2. The console fix

`conversationMention.ts:59` and `TicketReference.tsx:71` now draw
`phaseLabel`. Reverting both wraps fails exactly the two cases
(`expected 'Work' to be 'Working'`, `expected '#15Fix the thingWork' to contain
'Working'`), so the assertions pin the product's words rather than the
constructor. All five phase-bearing surfaces (`ProjectTable.tsx:155`,
`TicketHead.tsx:140`, `TicketSituation.tsx:89`, and these two) now go through
one function.

Grep for raw draws leaves one: `Inbox.tsx:361`, `{row.badge ?? row.phase}`.
Not a finding — see the notes.

## 3. The gate-suite commit (`9ab90d02`)

Both edits are necessary, proved by reverting each one alone:

- `GOLDEN="work-failed"` makes `check-conformance.test.sh` die at
  `cp: cannot stat .../work-failed.itf.json` before the biting case — a
  could-not-run wearing a pass.
- `SEED=0x3` makes `a phantom completion is a finding` go green
  (`1 run(s), 40 step(s) walked clean`): the mutant is never drawn. `0x1`
  draws it and the case is red for the right reason.
- The mutant's `ticketAt(core, …)` no longer names anything this tree has;
  restoring it reddens the gate for a reference error, not for the
  accumulator.

## 4. Comments

Every renamed comment describes its code: `revocableIn`
(`enablement.ts:33-35`) does exclude `"Finalization"`; `TicketGraph` is the
type at `modelTypes.ts:109`; `ticketProjection.test.ts:13`'s `Work` and
`ticketApproval.test.tsx:7`'s `TicketGraph` are the current names. No old
spelling survives in any file the three commits touch except the deliberate
backticked ones inside `decisionSemantics.ts`'s own header, which are naming
what a stored row says. No lesson is stated (house rule 16).

## 5. Gates

| Gate | Exit |
|---|---|
| `check-source` | 0 — 6 stages, unit ran 208 suites |
| `check-console` | 0 — 5 scripts, 1 built console |
| `check-comments` | 0 — 907 files |
| `check-figures` | 0 — 102 files |
| `check-paths` | 0 — 1207 claims, 1159 files |
| `sh .chug/tasks/check-conformance.test.sh` | 0 — 9 passed |
| `sh .chug/tasks/check-random.test.sh` | 0 — 16 passed |

## Notes — looked at, not flagged

- **`test/actor/decisionSemantics.test.ts:20-22`, the one thing I would
  change.** "it walks two tickets through every superseded spelling a row can
  hold: each phase, each of the five walls, the failed finalization and the
  four step labels" — the colon-list covers thirteen of the fourteen; the
  release event's own tag (`ReleaseTicket`, at `.event.type` of two rows) is
  not in it. The claim before the colon is true and the test enforces it, so
  this is a gloss that reads as exhaustive and is one clause short, not a
  false statement. Take it or leave it. The same omission is in the commit
  message, which is a record and stays as written.
- **`Inbox.tsx:361` draws `row.phase` raw, and it is unreachable today.**
  `row` is built only from `entry.held` (`Inbox.tsx:396-400`), `held` is set
  only for a phase-page ticket (`inboxUnion.ts:97-99`), and the phase page
  asks for `inboxPhases` = the `NeedsYou` section = `Escalated` alone, where
  `ticketBadgeLabel` always answers. So `?? row.phase` is a dead fallback
  today. It becomes the bug this PR just fixed the moment a second phase maps
  to `NeedsYou` in `ticketSectionOf`. Pre-existing, outside the diff, and a
  `phaseLabel(row.phase)` there would close it for nothing.
- **`bytes.includes(said)` is a substring test on the raw JSON.** I verified
  by path that all fourteen occurrences are at fields
  `rowAtCurrentVocabulary` actually walks, so the test is honest today. A
  future key that is a substring of a current one would pass vacuously. No
  concrete input fails, so it is not a finding.
- **`pinned("journalAtSemanticsFour.json", 1)` also passes.** The vintage
  argument on the new fixture is a declaration nothing pins, because the
  codec's pre-4 tolerances are a superset. Not a defect — `storedAt(…, 4)` is
  what the legality case declares, and that one bites.
- The sweep's unpinned §1 (six keys) and §2 (`event.value.out`) are both
  closed by this fixture. §3, §4, §5 and §6 are untouched and remain
  pre-existing.
- Practices invoked: `comments-describe-the-code`.
