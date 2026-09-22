# Round 1, surface half — `model/finalization-unavailable` at 344d443b

CHANGES — three findings, none of them a behaviour defect: the pass logic, the
dwell, the submission, the read and the console arms are all right as written.
Two of the three are guards that are load-bearing and unproved, which is the
shape this tree treats as worse than no guard at all.

What I read: `CLAUDE.md`, `.chug/tasks/review-change.md`, `GOAL.md`,
`survey.md` §4–§10, `tasks/B-report.md`, `tasks/C-report.md`, the copy-standard
memory, then in full `src/contract/rosters.ts`, `src/contract/responses.ts`,
`src/interpreter/finalizer.ts` (conclusion, config, store port),
`src/interpreter/finalizerRun.ts`, `src/interpreter/finalizerSettings.ts`,
`src/interpreter/nativeWeb.ts`, `src/interpreter/ticketCommand.ts`,
`src/interpreter/wire.ts:278-306`, `src/adapters/postgres/finalizer.ts`,
`src/adapters/postgres/nativeReads.ts`, `src/adapters/postgres/readiness.ts`,
`src/adapters/postgres/decision.ts:340-364`, the five console files and their
tests, `test/interpreter/finalizerRun.test.ts`, `test/contract/rosters.test.ts`,
`test/postgres/finalizerUnavailable.test.ts`, and — to judge my half's claims
against it — 007's hold door, third binding arm and grants.

## Findings

### 1. The per-request reset of `heldReason` is load-bearing and unproved

`src/interpreter/finalizerRun.ts:1766`. `tally.heldReason` is pass-scoped state
and `finalizerAdvance` clears it before each request; delete that one line and
**every case in the file still passes** (I ran it). The failure it prevents is
the one this PR exists to avoid: with two claimed requests in one pass, the
first held at an on-roster kind and the second moving, the second's record is
written with the first's kind. Probe, two views in one pass
(`unboundView("request-one")`, `preparableView("request-two")`):

- with the line: `store.holds === ["RepositoryUnbound", null]`
- without it: `store.holds === ["RepositoryUnbound", "RepositoryUnbound"]`

So a healthy request behind a persistently held one counts toward a dwell it
never entered, and after `holdPassesMax` passes is escalated at a kind it never
hit. House rule 13 and the standing commitment that an unverified control is
worse than none. Fix: a fifth case in `test/interpreter/finalizerRun.test.ts`
(the four dwell cases end at :2892) driving two requests in one pass and
asserting `store.holds` is the kind then `undefined`.

### 2. The third finalizer door is not held to the pinning the other two are

`test/postgres/finalizerPrivileges.test.ts:412` and `:432` are where this tree
says what a finalizer door is: its own role's and no prior role's, SECURITY
DEFINER, boundary-owned, `search_path` pinned. 007 adds a third — the
`record_finalization_hold` door, which is the only way those three columns are
written (the write-surface case at :354 still shows the finalizer role holds no
UPDATE on them) — and neither case was extended. `test/postgres/migration.test.ts`
covers the grant (finalizer yes, api no, public no) and the owner, so what is
asserted nowhere is `prosecdef` and the `search_path` pin, on a definer
function owned by `chuggy_boundary_owner`: a pin dropped by a later migration
reads exactly like one that is working. Both test names and the suite's own
prose now understate the surface too. Fix: add the door to both arrays and say
"three".

### 3. One of the thirteen labels is a clause where its twelve siblings are nouns

`ui/chuggy-ui/app/core/codeLabels.ts:94` — `"Proposal base is already head"`.
Every other label in this function and in `blockedReasonLabel` is a noun phrase
("Proposal denied", "No matching execution profile"); this one takes a copula
and reads as a sentence with the period missing. The copy standard is nouns and
one short line. `"Proposal base at head"` or `"Nothing to propose"` keeps the
line. Nit, and the only one I have about C's thirteen.

## Notes — read and not flagged

- **The thirteen and the five** are exactly GOAL.md's, in 007's order, and the
  complement is pinned in `test/contract/rosters.test.ts:200`; I red-proofed it
  by dropping `ProposalMergesExhausted` (the complement grows to six and the
  case fails).
- **The dwell** fires at `finalizerRun.ts:1745` when the *returned* count
  reaches `holdPassesMax`. Both off-by-ones are red: `<` → `>` fails "two
  passes are not the dwell"; `<` → `<=` fails the third-pass conclusion. The
  off-roster guard at :1736 is red too (dropping it fails the
  count-left-alone case). `holdPassesMax` is in `finalizerBounds` by derivation
  from `finalizerDefaults`, so `checkedFinalizerConfig` bounds it for free.
- **Traced holds**: `RepositoryUnbound` (gather → `Hold` arm) records and
  counts; `PreparationRestartsExhausted` (`finalizer.ts:715`) likewise;
  `ProposalMergeBlocked` after `TargetUnreadable` neither counts nor clears
  (:1736 returns before the door); a concluding pass records nothing
  (`tally.conclusions` moved). A pass ceiling holds at `PassCeilingReached`,
  off-roster, so a backlog cannot count a ticket toward escalation — right.
- **Two clears I judged harmless**: a pass whose submission is refused
  (`Refused`/`BindingMismatch`) clears rather than leaves alone, and `Settled`
  / `Abort` clear against a row the door will answer `BindingMismatch` for.
  Neither loses evidence a reader wants.
- **A duplicate report is absorbed**: the door is keyed on
  `sha256('finalization:'||request)`, so a re-claim between the submission and
  the actor's commit returns `AlreadySubmitted`.
- **The read**: `nativeReads.ts:567-572` is the most recent request by
  `authorizing_seq` under the reason filter, and the reason cannot be
  `FinalizationUnavailableEscalated` while a later request exists — a resume
  writes the new request and clears the reason in the same journal entry
  (`decision.ts:353-362`, a plain INSERT, so the new row's hold columns are the
  column defaults and the count is fresh; not asserted anywhere, and I would
  not add a case for a default).
- **The evidence**: `readiness.ts:206` answers `undefined` for the new outcome
  and the header now says why. I agree with B's refutation — the attempt bundle
  is not what held it.
- **The envelope**: 007 puts `kind` in the command JSON, `FinalizationSubmission`
  does not name it and `checkedFinalizationSubmission` does not check it (the
  spread at `wire.ts:305` carries it through untyped). Nothing reads it, so no
  failure happens; but a reader of the envelope type cannot see what the mailbox
  holds. Either name it or drop it, whenever the NeedsWork half is next opened.
- **Write amplification**: every moving request now costs one UPDATE per pass
  on `finalization_request`. Simplicity over performance says leave it.
- **C's judgment calls**: `finalizationUnavailableKindLabel`'s name and pairing,
  the `undefined` detail line, leaving A's sentence and resume point, and the
  `blockedBy`-first order are all right; the two wall fields cannot both be
  present, so the order is unobservable. Making `resumeSentence` exhaustive is
  the survey's silent-fallback finding closed.
- **Unsure about**: nothing that changed a verdict. The full roster is clean at
  this tip (`ci-full-344d443b.log`), which is why I read rather than re-ran it,
  beyond the mutations above.
- **Practices invoked**: `comments-describe-the-code` (no provenance comment
  survives in the diff — I grepped the added comment lines for it) and
  `modular-and-layered-code` (findings 1 and 2 are both its "test hardest at
  the boundary"). Worktree left as found; `npm ci` at the root only.
