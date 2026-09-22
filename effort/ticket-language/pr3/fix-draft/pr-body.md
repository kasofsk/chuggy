Regression from #723. The rename lifted every stored journal row through the actor's vocabulary map before the codec read it, and left one stored event outside any row: the authoring a draft retains (`draft_revision.authoring`) is the event its release journals, and every draft authored before semantics 5 spells it `ReleaseTicket`. `parseDraftAuthoring` parsed it at the current vocabulary and threw a `TypeError`, which `failureResponse` answers as 400 `InvalidRequest`. On the rig that broke the ticket view's Brief and Provenance panels, the drafts page, and `ReleaseDraft` for any draft authored before the deploy.

The event lift is its own function now (`eventAtCurrentVocabulary`), the row lift calls it, and `parseStoredDecisionEventText` reads a stored event text through it. A client's bytes are still parsed as sent. No migration: the bytes stay as written, as the journal's do.

Every stored draft authoring on the rig (all `ReleaseTicket`) parses on this branch and none on main.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
