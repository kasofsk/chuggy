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
  `ticket.qnt` imports it for `TaskIdentity`, `TaskDefinition`,
  `TaskObligation`, `ValidatedTaskResult` and `TaskTerminal`, and `domain.qnt`
  calls `taskIdentityValid` and `taskDefinitionValid`.
- `ticket-domain/evaluation/evaluation.qnt` is the same VERBATIM copy at the
  package's own path, so its own import of the task contract resolves
  unchanged. `diff` against the package is empty, and the same rule applies:
  do not edit it — change chuggy around it. `ticket.qnt` imports it for the
  instance and drives it with `begin`, `applyProduced`, `applyFailure`,
  `concludeStage`, `resumeBlocked` and `currentTaskObligations`; chuggy
  re-states none of them. `Escalation.EvaluationBlockedEscalated` staying
  nullary where the package's carries the instance is chuggy's own
  divergence, argued at the sum in `ticket.qnt` and left to PR 9.
