# The git service

**Status: PROPOSED** — kasofsk/chuggy#76 carries the standing-up.

Bare repositories, served over smart HTTP by their own single-replica service on the system pool — not a forge, and not the dispatcher's own volume. A later board or browse surface is a client of the dispatcher's API (doc 011), never a second system of record.

## Why a separate service

The deployment's sync agent reads the repository to converge the cluster, and this deployment restarts the dispatcher as a matter of routine — a deploy is a merge (doc 014) — so the reader that carries deploys must outlive the process being deployed. Welding the repositories to the dispatcher fuses exactly the two failure domains the loop needs apart. The wrap-up performer still owns every merge (doc 010): the service serves bytes and enforces scope, deciding nothing.

## Two credential classes

Static tokens, validated by the service itself with no other party standing: the sync agent's read, the dispatcher's own — the sole credential that may move a default branch — and the operator's break-glass. And per-job tokens, minted at spawn and introspected against the dispatcher's grant table, scoped to reading the project and pushing the one branch the task owns. The dispatcher unreachable means a job's access is refused, which fails closed and costs nothing a dead dispatcher had not already cost; ref scope is enforced where the push lands, so a compromised worker holds exactly its own branch.

## Backup

Every movement of a default branch bundles the repository out to object storage from the receive hook, and a schedule bundles everything regardless of movement; the restore is a fetch of everything from the newest bundle into a fresh bare repository, rehearsed before anything depends on it (doc 015).

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| P1 | The service, its image under `images/` <!-- intent -->, the seeded repository | P0 | Proposed |
