Step 4 of the ticket-language convergence (`~/claude/chuggy-effort/ticket-language/SPIKE.md`): Finalization Unavailable escalates.

**The failure this prevents.** A finalization the finalizer cannot carry out — an unbound repository, an unreadable target, a forge that will not answer, a preparation budget spent — left the ticket in Finalization with no operator exit: not revocable, not resumable, no native action, until the environment changed under it. Now it escalates, says why, and Resume re-runs it.

**The package's shape** (chug-ticket-domain 76c95a9): `FinalizationOutcome` gains `FinalizationResultUnavailable`; `Reason` gains `FinalizationUnavailableEscalated`; the decider escalates at `ResumeFinalization`, and the existing resume (`RunFinalizer` again, a new request at a later seq) is the package's generation + 1 on the same pinned input. Decision semantics stays 5: no stored row can name either new value.

**Which holds.** Thirteen of the finalizer's eighteen hold kinds are the result being unavailable (ten reachability holds and the three exhausted per-request budgets); `finalizationUnavailableKinds` is the roster. Five stay holds and the roster's doc says why each: a human's answer (`ApprovalDeclined`, the closed half of `ProposalRefused`) is NeedsWork for a later PR, `ProposalHeadMoved` is a rebuild, `ContradictoryEvidence` is a defect, `ProposalMergeBlocked` is indistinguishable from awaiting review.

**When.** A hold is recorded on its request (`finalization_request.hold_kind/hold_passes/held_since`, function `record_finalization_hold` under the finalizer's claim) and reported after `holdPassesMax` consecutive passes of the same kind, a finalizer setting with a code default, so no fabric change rides with this. The submission's third arm fences on the recorded hold as the other two fence on an attempt.

**The evidence reaches the reader.** The ticket read gains `finalizationBlockedBy`, present only while the reason is `FinalizationUnavailableEscalated`; the console draws it beside Parked as it does the execution wall.

**Migration 007** widens the two reason CHECKs and the three outcome lists, adds the three columns and the function, and grants exactly what the finalizer and api roles need. No guard, by argument in its header. Render-diff of 001–006 main vs branch is empty.

Reviews: `~/claude/chuggy-effort/ticket-language/pr4/reviews/ledger.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
