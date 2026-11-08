## A draft a screen follows as it is revised, and what became of one that
## left: `app/core/draftFollow.ts`, `TicketCreationDraft.tsx`.

drafts-heading = { -draft(case: "upper") } { $ticket }
drafts-behind = { -draft(case: "upper") } { $ticket } changed while you were editing; your edits are kept.
drafts-behind-choice = Take theirs to drop your edits, or keep yours to replace its new { -revision } with the whole { -ticket } as it is here.
drafts-closed-released = { -draft(case: "upper") } { $ticket } was { -release(form: "ed") } as { -ticket } { $ticket }, so there is nothing left here to { -release }.
drafts-closed-deleted = { -draft(case: "upper") } { $ticket } was deleted, so there is nothing left here to { -release }.
