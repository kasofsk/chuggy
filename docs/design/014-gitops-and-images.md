# GitOps and images

**Status: PROPOSED** — kasofsk/chuggy#75 through #78 carry the phases.

A merge to the default branch is the deploy: the cluster converges on `deploy/` <!-- intent --> as merged, watched by Flux from the repository the deployment itself hosts. Chuggy stays agnostic to deploy mechanism — a deploy is a ticket whose work edits that directory and whose wrap-up merge ships it — and that agnosticism is why no deploy machinery enters the machine.

## Why Flux, and why no image automation

The watcher polls a plain smart-HTTP repository with a token and assumes no forge, and it brings no interface of its own to operate — the desk is this deployment's one surface. Image-automation controllers are declined for a sharper reason than taste: rolling a tag is a push to the default branch, and the default branch moves only by the wrap-up's credential. A new image reaches the cluster as a deploy ticket — work builds it and edits the tag, evaluation judges, the merge deploys — so every rollout is journaled, priced and reviewed exactly like any other change.

## A build is a task type

Jobs hold no cluster credential and no cloud identity, so nothing a job runs may spawn other Jobs — the work Job is the builder, running rootless BuildKit as its own command, its registry push credential minted at spawn and injected like every other grant. The bootstrap and the break-glass are the same path: build locally, push by hand.

## The images

One directory per image under `images/` <!-- intent -->, bases pinned by digest, no floating tag anywhere. The evaluation image is the `.chug/tasks/ci.sh` contract made flesh: a real clone with its history and its executable bits, the toolchain the lockfile pins, and the timeout the suite cap depends on — and only a zero exit declares a pass, a could-not-run being a fail like any other, retried below the cycle where retries belong.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| P1 | Flux bootstrapped against the hosted repository | P0 | Proposed |
| P2 | The images, built and pushed by hand | P1 | Proposed |
| P3 | The first build ticket and the first deploy ticket | P2, R8 | Proposed |
