---
name: stored-text-outside-the-journal
description: A vocabulary rename must lift every stored event text, not only journal rows; draft_revision.authoring was missed by PR 3 and broke the ticket view's Brief/Provenance on the rig
metadata:
  type: feedback
---

PR #723 (the rename, 2026-09-21) lifted journal rows through `rowAtCurrentVocabulary` but missed `draft_revision.authoring`, which stores the `CreateTicket` (old `ReleaseTicket`) event a draft's release journals. Every stored draft read threw and the API answered 400 InvalidRequest; Geoff saw it in the ticket view's Brief and Provenance panels. Fixed by #724 (`eventAtCurrentVocabulary`, `parseStoredDecisionEventText`). The reviewer of #724 audited every other stored-text reader and found no second gap.

**Why:** the survey for the rename grepped columns with CHECKs and the journal; an opaque `text` column holding a model event has no constraint to find. My post-release sanity check read a ticket and a configuration and never a draft, so it passed.

**How to apply:** a rename PR's survey lists every column that stores a model event or record as opaque text (`journal_entry.entry`, `draft_revision.authoring`, `operation.command`, `selector_proposal_delivery.command`; `decision_input` has no command column, it points at an operation or continuation) and names the lift each reader goes through. Post-release rig sanity checks read a ticket, its draft (`GET .../drafts/<n>`), the drafts page, and a configuration. See [[chuggy-rig]], [[ticket-language-2026-09-20]].
