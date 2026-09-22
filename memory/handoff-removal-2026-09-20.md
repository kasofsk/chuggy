---
name: handoff-removal-2026-09-20
description: The post-promotion handoff phases left the model, code and schema on 2026-09-20 (PRs #712, #713); what is still owed afterwards
metadata:
  type: project
---

PR #712 (main bde7006f) removed the handoff phases from the Quint model and every
code layer; PR #713 (main 81e8093a) added migration 003, which guards first and
applies only where no handoff was ever completed. Effort dir
`~/claude/chuggy-effort/handoff-removal/` (GOAL.md, briefs, reports, reviews,
sweep).

**Why:** decided 2026-09-16 with the ticket chain (see
[[ticket-chain-decision-2026-09-16]]); the machinery duplicated a ticket's own
work and no configuration carried the shape.

**How to apply:**
- The rig sits at schema version 1; 002 (worker pool) and 003 roll together at
  the next release (see [[rig-release-runbook]]). The rig held zero handoff rows
  on 2026-09-20, so 003's guard passes there.
- `RepositoryBinding.credentialReference` now has no producer, but the fabric's
  `cluster/apps/chuggy-finalizer.yaml` names `credentialReference: portal-app`
  on a repository credential source. Removing the chain starts with a fabric
  change, then `finalizerSettings.ts:49`, `ticketService.ts`,
  `configurationImporterConfig.ts`, `credentialFiles.ts`. NOT `compose.ts:513`,
  which is the forge binding's live credential key.
- Finalizing → Escalated on infrastructure failure (Dave's other half) is its
  own PR, not started.
- The `chuggy-handoff:` proposal marker stays: it is on real PR bodies.
