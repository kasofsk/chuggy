---
name: evaluation-is-the-review
description: "A ticket's evaluation stages ARE the adversarial review; Push finalization straight to chuggy main is accepted for now only because the finalizer's branch-and-merge work is not done"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d1fa046a-7e9c-42d1-8994-81dda7e86041
  modified: 2026-09-07T05:41:46.603Z
---

On 2026-09-07 I reported ticket 51's Push finalization onto kasofsk/chuggy main
as "main moved without a review". Geoff corrected it: the evaluation step is an
adversarial review, "but fair", and this is chuggy dogfooding itself.

He then drew the line precisely: "pushing to main is the route we are accepting
at the moment as we havent yet done the finalizer work to actually open a PR. or
we may not ever open a PR exactly but we should still be explicit that work is
done on branches and merged to main after it passes review rather than being
committed directly so to speak."

**Why:** the ticket's evaluation stages (the `prog` list on ReleaseTicket) are
the review; a commit that passed them is reviewed. What is NOT settled is the
landing: the intended shape is a branch that is merged to main after review
passes, whether or not a GitHub PR is the vehicle. Today's finalizer pushes the
candidate straight to main because that branch-and-merge work has not been done,
and that is an accepted interim, not the standard.

**How to apply:** describe a rig ticket's evaluation stages as the review they
are; never call a Push-finalized commit unreviewed. When the finalizer's landing
comes up, the target is "work on a branch, merged after review", not "direct
commit" and not necessarily "open a PR". Worker commits on main are expected for
now ([[chuggy-rig]]); branches cut before one rebase over it. Related:
[[merge-authority-2026-08-31]], [[review-discipline]].
