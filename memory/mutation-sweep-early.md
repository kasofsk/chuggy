---
name: mutation-sweep-early
description: "Step 1 of multi-repo took six review rounds because each fresh reviewer found one unheld term; the whole-artifact mutation sweep belongs in round two, and a sweep verdict ships unless it finds a behaviour defect"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bdd96a53-fc09-48f0-8982-b564cd473b78
  modified: 2026-09-09T20:08:18.244Z
---

Geoff, 2026-09-09, after step 1 of the multi-repo effort reached a sixth
review: "six rounds on step 1. are we going crazy with nits?" Rounds 1–2 found
behaviour defects; rounds 3–5 each found one control with no assertion
(coarse red-proof, a regression test that stopped regressing, an unheld fence
term, an unheld lock), fixed one at a time.

**Why:** a fresh reviewer briefed on "does every assertion bite" finds the
first gap and stops; the next reviewer finds the next. Five rounds of that is
the orchestrator's failure, not the reviewers'.

**How to apply:** on a SQL migration, a gate, or any guard-heavy change, the
*second* review is a whole-artifact mutation sweep — enumerate every conjunct,
branch, lock, constraint, grant and REVOKE, delete or invert each alone, table
which assertion fired. Unfalsifiable terms are named as such. A sweep round
ships unless it finds a behaviour defect; an unheld assertion it turns up is
fixed and red-proved in place with no further fresh round. Related:
[[review-discipline]], [[guards-fail-open]].
