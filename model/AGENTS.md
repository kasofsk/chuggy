# Model

- This Quint model is the authoritative behavioral specification.
- `ticket-domain/`, `task-contract/`, and `application/` specify the adopted
  ticket engine. Preserve their pinned upstream sources; add local integration
  tests beside them.
- `identity.qnt` specifies installation identity independently of ticket
  lifecycle behavior.
- Change model tests with behavior and run `.chug/tasks/check-model.sh`.
- Regenerate derived artifacts with their repository scripts; do not hand-edit
  generated APIs or golden traces.
