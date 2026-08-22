# Model

- This Quint model is the authoritative behavioral specification.
- For machine changes, rework `measure.qnt` first and preserve the standing
  rules named in the model headers.
- Change model tests with behavior and run `.chug/tasks/check-model.sh`.
- Regenerate derived artifacts with their repository scripts; do not hand-edit
  generated APIs or golden traces.
