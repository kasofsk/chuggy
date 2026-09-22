| round | tip | verdict | note |
|---|---|---|---|
| author | aef4c3b7 | — | correction at ≤3; 005 guard arm deleted in place; 7-mutant sweep |
| round 1 | aef4c3b7 | CHANGES | parked set not restricted to replayed-Pending dependents; duplicates copied; sent back |
| fix | b5d30cd1 | — | parked set = replayed-Pending dependents, deduped; forgedParks table; 7 mutants red; ci changed-run exit 0 |
| round 2 | b5d30cd1 | APPROVE | filter equals the deleted decider's (Pending-only, deduped, transitive closure admitted); probe of rig journal replay requested before merge |
| PR | #722 → main 55de9de6 | merged | rig journal replays legal on the tip (chuggy 662 rows, rehearsal 30), refused on ba0c5a68 at seq 203/5; release phase 1 running |
