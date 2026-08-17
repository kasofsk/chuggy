# The desk and identity

**Status: PROPOSED** — kasofsk/chuggy#69 and #73 are the tickets.

The desk becomes an authenticated HTTP face served by the dispatcher: the board is rendered from the live core joined with the ticket annex — derived, never stored — and every write goes through the inbound face with enablement's refusal returned as the answer. The API is the product; the first UI is server-rendered markup with no build step and no client dependency, and every later surface is another client of the same face.

## Identity

A caller presents a token from one issuer — Google's — verified against its published keys; the registry maps a verified subject to a display identity and to references naming its credentials, and absence from the registry is the refusal. Verification uses `jose`, the one new runtime dependency this deployment admits, because signature verification is the wrong thing to hand-write; its justification lands in its commit.

## Per-user credentials against the node-grants rule

The two reconcile at one point: the author is written by the authenticated desk at arrival and never changes, and at spawn the resolution reads configuration alone — the registry row and the task-type catalog — so nothing a work task writes can influence which credential reaches a job, and a subject with no stored grant fails the spawn closed. Credentials transit as references; the material moves only between the secret store and the job the spawn named.

## The annex

Title, brief, task type and author are annex rows keyed by the dense ticket id, written at arrival beside the journaled decision. The one seam is stated rather than papered over: the arrival and its annex row are two writes, and a crash between them leaves a draft whose annex is empty — visible on the board, re-editable by its author, refusing nothing — which is why the two are not forced into one transaction that would weld the registry to the journal store.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R3 | The face: routes, identity, registry, rendered board | #68 | Proposed |
| R7 | Spawn-time credential resolution | #69, #71, #72 | Proposed |
