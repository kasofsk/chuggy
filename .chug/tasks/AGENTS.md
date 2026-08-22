# Gates

- Each gate's header is the authoritative statement of its rule; read it before
  changing the gate.
- Keep every gate paired with its sibling `*.test.sh`, including a fixture that
  proves the rule rejects its violation.
- Preserve exit 0 for clean, 1 for a finding, and 2 for could-not-run where the
  gate uses all three states. Exit 2 is never a pass.
- Keep `ci.sh` as the single definition of full-gate sequencing.
- Run the changed gate's suite and `just suites`; run `just check` before
  handoff.
