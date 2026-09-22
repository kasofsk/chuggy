---
name: rig-tickets-disposable
description: Geoff (2026-09-21): the rig's tickets can all be blown away if it simplifies a migration path; no more structural lifts or semantic corrections for old rows
metadata:
  type: feedback
---

Geoff, 2026-09-21, after the #724 regression: "we can totally blow out all the tickets if it simplifies the migration path." Then, "i dont care about old drafts and stuff", and: "when you are ready i encourage you to proactively blow out the ticket rows and anything else that makes data migration a part of keeping the core train intact." Also: tiny lift adapters are fine, but it is okay for old-row reads to be broken, and I am free to push back when he asks for such fixes.

**Why:** the rig's journal is rehearsal data. Each convergence PR was spending a real slice on old-row replay (semantic corrections, frozen fixtures, replay probes, migration guards), and PR 2's release failed on exactly that.

**How to apply:** proactively, not on request: whenever a migration or a release is simpler over an empty ticket set, dump and wipe the rig's ticket rows (journal, projections, drafts, requests, continuations) at release and say so in the record. For PR 5 (Escalated as a sum) and later shape changes, do not build a lift for pre-change rows. Take the dump, then reset the rig's ticket data at release (or refuse-and-reset in the migration) and state it in the release record. Keep the cheap word-map lifts that already exist. Still keep the dogfooding surface working: a fix for a broken live read is not "old data", see [[stored-text-outside-the-journal]]. See [[ticket-language-2026-09-20]].
