# Deployment rig

- Treat the README and file headers in each rig subtree as the procedure and
  the boundary of what it proves.
- Do not apply manifests, rotate credentials, destroy or restore data, alter a
  cluster, or run teardown steps without explicit approval.
- Prefer the narrow rehearsal or sibling test for the changed subtree; do not
  infer production guarantees from this local rig.
