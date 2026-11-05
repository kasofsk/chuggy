# Model

- This Quint model is the authoritative behavioral specification.
- For machine changes, preserve the standing rules named in the model
  headers.
- Change model tests with behavior and run `.chug/tasks/check-model.sh`.
- Regenerate derived artifacts with their repository scripts; do not hand-edit
  generated APIs or golden traces.
- The ticket package (github.com/kasofsk/chug-ticket-domain) is the
  `@kasofsk/chug-ticket-domain` dependency, pinned in `package.json`; its
  `task-contract/` and `ticket-domain/` models are imported from
  `node_modules`. `check-model` runs the package's own `ticket_tests.qnt`, and
  `test/conformance/package.test.ts` replays its traces through chuggy's
  TypeScript. Chuggy's modules import it and restate none of it. Change chuggy
  around it, and bump the pin with the package manager.
