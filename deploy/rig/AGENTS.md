# Deployment rig

- Treat the README and file headers in each rig subtree as the procedure and
  the boundary of what it proves.
- A bring-up starts at `preflight.sh`, which names every object an operator
  issues by hand and creates none of them, and continues into `bring-up.sh`.
  An object one of them reports absent is the operator's to make, never this
  tree's to invent a default for.
- Do not apply manifests, rotate credentials, destroy or restore data, alter a
  cluster, or run teardown steps without explicit approval.
- Prefer the narrow rehearsal or sibling test for the changed subtree; do not
  infer production guarantees from this local rig.
