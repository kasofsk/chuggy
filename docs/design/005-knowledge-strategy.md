# The knowledge strategy

**Status: PROPOSED** — nothing below is enforced yet; the landing table at the end sequences what will be. Issue #58 is the interim ticket.

The standard is already this tree's: the repo carries what is true, and the record carries what was learned. What nothing states yet is where a lesson goes when it arrives mid-ticket — and a bare rule against writing it into the tree fails on its own, because the pull is structural: insight arrives during work and wants to be written where the worker is standing. So the decision here is a pair. A rule closes the tree to lessons, and a loop gives them a destination.

## The failure

Observed 2026-08-15/16, during the pure-core build — a lesson journaled into the tree during the ticket that taught it, at three sizes, and then the failure's other half.

Nine `## Correction` sections accumulated on `docs/design/004-pure-core-implementation.md`, eight in one day, and the doc reached 13,128 words before `d24d3d8` cut it to 1,840 (2026-08-16, counts by `git show d24d3d8^:docs/design/004-pure-core-implementation.md | grep -c '^## Correction'` and `wc -w` over the same blob and its successor). The gate headers grew to 1,638 comment lines of weighed alternatives and history before `579f51f` cut them to 1,027 (2026-08-16, by the pipeline in that commit's message), with the arguments left where they already were — the commit messages that made each change. A worker added a testing-standards paragraph to a module header mid-ticket, in a ticket about something else.

And the other half: the one genuinely systemic lesson of the build — gates reporting figures nothing measured — took five instances across four authors to become house rule 15 (the count is issue #58's), because each instance was reviewed in isolation. A reader across tickets would have caught it at the second.

## The inner loop: a change states no lesson

House rule 16, worded for `.chug/tasks/review-change.md`:

> **16. A change states no lesson.** A new standard, convention or piece of meta-commentary lands only in a ticket whose stated scope is that rule. What a change taught stays in the ticket's own artifacts — session, report, review verdict, commit message — where the observer reads it. Two edits are not lessons: repairing a claim this diff made stale, which zero technical debt requires of every ticket, and a gate ticket revising its own header, which is its stated scope because the rule statement is the enforcement's file.

The carve-outs are load-bearing, and `579f51f` is why: it repaired two CLAUDE.md claims its own diff had made stale, inside a gates ticket. Without the first carve-out that repair is a violation, and under the zero-technical-debt commitment it is mandatory — so the rule's first citation would be a fight with a commitment instead of a finding.

The reviewer enforces it, which is what makes it a house rule: no script can decide whether a sentence states a norm.

## The record

The ticket machine this repo implements is the record. Tickets and their artifacts — work outputs, agent sessions, evaluation outcomes, rework cycles and their reasons — are what the observer reads. Until the machine stores them, git history and pull requests serve, and session transcripts serve while they exist; nothing is preserved beyond what those already keep. No parallel record infrastructure lands, because building one would rehearse the database the workstream is already building.

## The outer loop: the observer

Not a component of the machine, and totally independent of the domain implementation. It reads the record across tickets, on demand at milestones, so the workstream's velocity is never gated on it. Its brief will be `.chug/tasks/retro.md` <!-- intent -->, sibling to the reviewer's and run the same way: a fresh session that authored nothing it reads.

Proposals originate in the observer and nowhere else. A worker files no rule proposal mid-ticket; its lesson waits in the ticket's artifacts to be read. The gate on a proposal is recurrence — two to three instances, or one severe — and owner review, so the output is rare, small and intentional, and `blessed-practices` does not become the new journal.

Two write surfaces, routed by generality:

- **General** → a PR against `kasofsk/blessed-practices`. A skill states what good code looks like anywhere, never what is true here.
- **Project-specific** → a change in this tree, placed in the thing that enforces it: a gate, a rule in the reviewer's brief, a CLAUDE.md convention.

And it prunes in both directions: a practice or rule that stopped earning its place is the observer's to remove, not only to add to. The bar for a removal is deliberately unset here; the first retro proposes it from what pruning actually looked like, owner-reviewed like everything else the observer emits.

## The pilot

The first retro runs after S8 lands, over the record of the pure-core build: the git history, the pull requests, issue #58 itself, and whatever of the 2026-08-15/16 sessions still exists when it runs. Its expected outputs are candidate rules, candidate prunes, and the removal bar above. House rule 15 and `.chug/tasks/check-knowledge.sh` are the calibration: both are observer-shaped changes that happened inline, because the observer did not exist yet, and the loop's outputs match their voice and placement.

## Landing

| # | What lands | Where | Depends on | Status |
|---|---|---|---|---|
| K0 | House rule 16 | `.chug/tasks/review-change.md` | — | Proposed |
| K1 | The observer's brief | `.chug/tasks/retro.md` <!-- intent --> | K0 | Proposed |
| K2 | The first retro, and the removal bar it proposes | the record, not this tree | S8, K1 | Proposed |

K0 is a small commit on `pure-core` and blocks nothing; S6 through S8 continue unimpeded.
