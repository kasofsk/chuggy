# The knowledge strategy

**Status: IN PROGRESS** — K0 is landed and enforced; K1 and K2 are proposed, and with S8 landed only K1 stands before the first retro. Issue #58 is the interim ticket, and it carries the motivating evidence and the discussion record.

The standard is already this tree's: the repo carries what is true, and the record carries what was learned. The observer below is the half the tree does not carry yet: a destination for lessons that arise while work is under way.

## The record

The ticket machine this repo implements is the record. Tickets and their artifacts — work outputs, agent sessions, evaluation outcomes, rework cycles and their reasons — are what the observer reads. Normal work leaves this evidence as a by-product of completing its task; it does not also maintain instructions, process or a lesson journal. Until the machine stores them, git history, pull requests and the ticket serve, and session transcripts serve while they exist; nothing is preserved beyond what those already keep. No parallel record infrastructure lands, because building one would rehearse the database this tree just built the core of.

## The observer

Not a component of the machine, and independent of the domain implementation. It reads the record across completed tickets at a scheduled cadence and on demand at milestones or after a severe event, so the workstream's velocity is never gated on it. Its brief will be `.chug/tasks/retro.md` <!-- intent -->, sibling to the reviewer's and run the same way: a fresh session that authored nothing it reads.

Proposals originate in the observer and nowhere else. A worker files no rule proposal mid-ticket; its lesson waits in the ticket's artifacts to be read. The gate on a proposal is recurrence — two to three instances, or one severe — and owner review, so the output stays rare, small and intentional, and `blessed-practices` does not become the new journal. Each proposal names its evidence, expected benefit, owner, enforcement surface and the observation that will tell the next retro whether it earned its place.

Two write surfaces, routed by generality:

- **General** → a PR against `kasofsk/blessed-practices`. A skill states what good code looks like anywhere, never what is true here.
- **Project-specific** → a change in this tree, placed in the thing that enforces it: a gate, a rule in the reviewer's brief, a CLAUDE.md convention.

Neither surface journals a task. In particular, a source comment is only for a local, durable code fact that names, types, tests and structure cannot express; history, alternatives, process guidance and instructions to a future worker remain in the record. Every promotion is a separately scoped, owner-reviewed change, never an edit folded into the work that supplied its evidence.

And it prunes in both directions: a practice or rule that stopped earning its place is the observer's to remove, not only to add to. The bar for a removal is deliberately unset here; the first retro proposes it from what pruning actually looked like, owner-reviewed like everything else the observer emits.

## The pilot

S8 has landed, so the first retro is due: it runs over the record of the pure-core build — the git history, the pull requests, the ticket, and whatever of the 2026-08-15/16 sessions still exists when it runs. Its expected outputs are candidate rules, candidate prunes, a removal bar, and a proposed cadence and effectiveness check for the observer. House rule 15 and `.chug/tasks/check-knowledge.sh` are the calibration: both are observer-shaped changes that happened inline, because the observer did not exist yet, and the loop's outputs match their voice and placement.

## Landing

| # | What lands | Where | Depends on | Status |
|---|---|---|---|---|
| K0 | House rule 16 | `.chug/tasks/review-change.md` | — | **Landed** `247f5c5` |
| K1 | The observer's brief | `.chug/tasks/retro.md` <!-- intent --> | K0 | Proposed |
| K2 | The first retro, and the removal bar it proposes | the record, not this tree | S8, K1 | Proposed |
