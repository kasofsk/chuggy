# Model

- This Quint model is the authoritative behavioral specification.
- For machine changes, preserve the standing rules named in the model
  headers.
- Change model tests with behavior and run `.chug/tasks/check-model.sh`.
- Regenerate derived artifacts with their repository scripts; do not hand-edit
  generated APIs or golden traces.
- `task-contract/` and `ticket-domain/` are the ticket package
  (github.com/kasofsk/chug-ticket-domain) vendored at its own paths, byte for
  byte, at the pin `vendored.sha256` records with the command that produced its
  digests; `.chug/tasks/check-vendored.sh` holds the tree to it,
  `check-model` runs the package's own `ticket_tests.qnt`, and
  `test/conformance/package.test.ts` replays its traces through chuggy's
  TypeScript. Chuggy's modules import it and restate none of it. Do not edit a vendored file: change chuggy
  around it, and bump the pin by re-vendoring from a clone and regenerating the
  manifest, never by hand.
