# Documentation catalogue

One row per tracked `docs/**/*.md`, including this page, grouped by directory.

**Adding a document is two acts, the file and its row.** Once `check-doc-facts.sh` lands, the two sets are compared both ways — a doc with no row and a row naming no doc are equally a finding — so the gate is what keeps the second act from being the one everyone forgets.

The row is a one-line summary, and writing it is the point as much as having it: a doc nobody can summarise in one line is a doc worth reconsidering before it merges.

## Root

| Doc | What it is |
|---|---|
| [README.md](./README.md) | This catalogue. |
| [concepts.md](./concepts.md) | The concept registry — which doc owns each term's definition. A routing table, not a glossary. |

## reference/

| Doc | What it is |
|---|---|
| [reference/style.md](./reference/style.md) | The tiered blessed practices, each Tier 1 rule tagged live or pending. Written to be injected into a work agent's prompt; reviewers reject by rule name. |
| [reference/docs.md](./reference/docs.md) | The doc policy: the two kinds and their opposite update rules, the claim markers, and the gates table with what each deferred gate is waiting on. |
| [reference/architecture.md](./reference/architecture.md) | How chuggy is built: the model-leads arrangement, the four standing rules, what the model proves, the single writer and journal-before-effect, deciders and effects, the authority split, and ports. |
| [reference/layering.md](./reference/layering.md) | The generic structural practice: the dependency rule, the layers and what each owns, what may cross a boundary, ports and adapters, and what layering costs. |
| [reference/domain-modelling.md](./reference/domain-modelling.md) | The generic modelling practice: the ubiquitous language, aggregates as consistency boundaries, entities and values, illegal states, where behaviour lives, persistence, and bounded contexts. |

## design/

| Doc | What it is |
|---|---|
| [design/001-what-chuggy-is-not.md](./design/001-what-chuggy-is-not.md) | The absences and rejected alternatives, each with its argument — the decisions a proved model structurally cannot record, because an absence has nothing to state it. |
| [design/003-layering-and-domain-canon.md](./design/003-layering-and-domain-canon.md) | Which parts of the DDD and layering canon are adopted, adapted or declined, with the argument for each and the conditions that would revive a deferred pattern. |
