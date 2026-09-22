# Model

- This Quint model is the authoritative behavioral specification.
- For machine changes, preserve the standing rules named in the model
  headers.
- Change model tests with behavior and run `.chug/tasks/check-model.sh`.
- Regenerate derived artifacts with their repository scripts; do not hand-edit
  generated APIs or golden traces.
- `task-contract/task.qnt` is a VERBATIM copy of the package's file at pin
  76c95a9, not a chuggy module: the package is not a dependency at this pin, so
  a copy is the only way to speak its vocabulary, and an exact copy is the only
  copy a `diff` can check for drift. Do not edit it — change chuggy around it.
  `ticket.qnt` imports it for `TaskIdentity`, and `domain.qnt` calls
  `taskIdentityValid` and `taskOwner`; its `TaskDefinition`, `TaskObligation`,
  `ValidatedTaskResult`, `TaskFailure` and `TaskTerminal` have no caller here
  yet and typecheck alone.
