---
name: step7-rehearsal-is-geoffs
description: "Multi-repo effort: merge, roll out, bind and import — everything short of driving a ticket through; the ticket is Geoff's live test"
metadata:
  type: feedback
---

Geoff, 2026-09-09, after steps 1–3, 5, 6 merged and step 4 was dispatched:
"dont do a rehersal, when it should be done halt and i will test myself", then
"to be clear you should merge and roll everything out, then i will test it
live on the rig." Then: "okay do everything short of driving tickets through."

**Why:** the live test — binding chuggy-fabric to `vteng/chuggy`, importing
both repositories, driving a real fabric ticket through the rig to a PR — is
the acceptance he wants to see with his own eyes. Rollout is not the test; it
is the precondition, and it is mine.

**How to apply:** merge every step before 7 (chuggy step 4, its fabric
follow-up setting chuggy-fabric `imported = true`), then roll it all out under
the standing rig grant: the chuggy release through `deploy/rig/deploy-to-gtr.sh`,
the worker image rebuild chain where `images/worker/` moved, the fabric merge,
host rebuild if nix changed, `flux reconcile kustomization apps --with-source`,
and a verification that the rig runs the merged code. Then halt with a plain
statement of what is deployed, bound and imported, and that the rig is ready.
Do not create or drive a ticket. Related: [[chuggy-rig]], [[rig-release-runbook]].

**Update 2026-09-16:** after the chain was shown ready (both bindings
PullRequestMerge, old console gone in fabric #226), Geoff said "yeah you can run
it, but use a sub agent for it" for the chuggy-ui rollout of chuggy 38c815f6. So
the FIRST live drive is delegated: an opus subagent files the fabric-change and
fabric-rollout tickets through the api as a minted project member and watches
every stage; ledger at `~/claude/chuggy-effort/self-rollout/first-drive/LEDGER.md`.
The standing rule for later real changes is unchanged unless he says otherwise.

2026-09-16 update: Geoff killed the drive subagent and drives tickets himself through a thread in the UI; I watch the rig, diagnose, fix the fabric, and merge. The 5e37c51f release (schema baseline) was rolled by hand with a ledger swap, see [[rig-release-runbook]].
