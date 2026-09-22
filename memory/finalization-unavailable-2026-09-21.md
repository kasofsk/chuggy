---
name: finalization-unavailable-2026-09-21
description: PR 4 of the ticket-language convergence (Finalization Unavailable escalates) — the orchestrator's decisions on which finalizer holds escalate, the dwell rule, and what stays a hold; effort dir chuggy-effort/ticket-language/pr4/
metadata:
  type: project
---

Decided 2026-09-21 under Geoff's overnight grant (see [[overnight-autonomy-2026-09-21]]), part of [[ticket-language-2026-09-20]]. Survey and goal: `~/claude/chuggy-effort/ticket-language/pr4/{survey,GOAL}.md`.

Thirteen of the finalizer's eighteen `FinalizationHoldKind`s become `FinalizationResultUnavailable`
(ten reachability holds plus the three exhausted per-request budgets, which are the finalizer's own
bounds). Five stay holds: `ApprovalDeclined` and the Closed/Superseded/Merged half of
`ProposalRefused` are a human's answer and belong to NeedsWork in a later PR; `ProposalHeadMoved`
is a rebuild; `ContradictoryEvidence` is a durable-row defect; `ProposalMergeBlocked` is
indistinguishable from "awaiting review". A hold is recorded durably on `finalization_request`
(`hold_kind`, `hold_passes`, `held_since`, migration 007, function `record_finalization_hold`)
and reported Unavailable after `holdPassesMax` passes (code default, no fabric change). The
ticket read carries `finalizationBlockedBy` while the reason is `FinalizationUnavailableEscalated`.
Decision semantics stays 5.

**Why:** a held finalization today has no operator exit at all (not revocable, not resumable);
escalating on the first hold would make every forge blip a desk item; a human's "no" is not
"unavailable".

**How to apply:** if Geoff disagrees with any of the five exclusions or the dwell, the roster
`finalizationUnavailableKinds` and `holdPassesMax` are the two knobs; nothing else encodes the
choice.
