# PR 7a — review ledger (branch `model/evaluator-keys`)

| round | tip | reviewer | verdict | fix |
|---|---|---|---|---|
| 1 machine | e3b7570c (A b8937233 + S d208b133 + B; C pending, ui/ only) | fresh opus | pending | |
| 1 surface | 00664232 (C on top of e3b7570c) | fresh opus | pending | |
| 1 surface | 00664232 | fresh opus | CHANGES (two coverage gaps, code correct) | orchestrator: provenance two-width case, remove-path case, both red-proved → after 68ac25c6 (clone fix from the full roster) |
| 1 machine | e3b7570c | fresh opus | CHANGES (`sameKeys` not injective — fails open on two live tasks sharing a key; stale fan-out sentence in `domain.qnt`) | orchestrator 39f5f76a + 7a85b85a, red-proved against the unfixed guard |

Tip for sweep: 7a85b85a (A b8937233 + S d208b133 + B e3b7570c + C 00664232 + 68ac25c6 clone fix + 45900887 surface cases + 39f5f76a/7a85b85a machine fixes). Affected roster clean at the tip.
| sweep | 7a85b85a | fresh opus | APPROVE (97 mutations, 74 red, 23 survivors, 0 behaviour defects; 4 cheap findings) | orchestrator 6d38ced1: four shape rows in 011's table, `evaluatorsMax` at a config where the bounds differ, the picker's add path, the stage-zero fixture; five red-proofs |
