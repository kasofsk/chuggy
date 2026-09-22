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
  `ticket.qnt` imports it for `TaskIdentity` and `TaskTerminal`, and
  `domain.qnt` calls `taskIdentityValid` and `taskOwner`; its `TaskDefinition`,
  `TaskObligation` and `ValidatedTaskResult` have no caller here yet and
  typecheck alone.
- `ticket-domain/evaluation/evaluation.qnt` is the same copy at the package's
  own path, so its own import of the task contract resolves unchanged. It is
  NOT verbatim, and every divergence is a producer of a task DEFINITION,
  which is PR 8's — this is the whole list, and `diff` against the package
  prints exactly these hunks:
  - `EvaluatorDefinition` carries `key` alone.
  - `EvaluationInput` carries `ticket` and `workResult` alone.
  - `planValid` drops `taskDefinitionValid(entry.task)`.
  - `invariant` drops `acceptedSourceRef > 0`.
  - `currentTaskObligations` yields task IDENTITIES: forced by the first
    divergence, which leaves no definition to complete an obligation with.
  - `applyProduced` therefore takes the result REFERENCE, where the package
    takes the `ValidatedTaskResult` that carries one.

  Do not edit anything else in it. `ticket.qnt` imports it for the instance
  and drives it with `begin`, `applyProduced`, `applyFailure`,
  `concludeStage`, `resumeBlocked` and `currentTaskObligations`; chuggy
  re-states none of them. `Escalation.EvaluationBlockedEscalated` staying
  nullary where the package's carries the instance is chuggy's own
  divergence, argued at the sum in `ticket.qnt` and left to PR 9.
