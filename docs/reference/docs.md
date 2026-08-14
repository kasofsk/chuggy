# The doc policy

Audience: whoever is about to write or change a document. This page is the rules, in the present tense.

The comment ban (`style.md` Tier 1 rule 1) is what makes this load-bearing. Knowledge that would have been a comment has exactly one place to go, and these are the rules for that place.

## Two kinds, opposite update rules

|  | **Reference** | **Design** |
|---|---|---|
| Where | everything under `docs/` except `docs/design/`, plus `CLAUDE.md` | `docs/design/*.md`, and nothing else |
| What it holds | the system as it is now | one decision, and why it was taken |
| Tense | present, always | present in the head; dated past in the body |
| History | none — no `Status:` line, no changelog, no "we decided" | the whole point |
| How you edit it | rewrite the sentence that is now wrong, in place | rewrite the **head** freely; extend the **body** only by appending |

A **plan** is not a third kind. It is a design doc with a slice table.

Two mistakes worth naming, because both are easy and both are common:

**A reference doc never narrates a change.** "The gate now also checks X" is a sentence that is wrong the moment something changes it again. Write what is true; let git hold what happened.

**A design body is never edited in place.** The decision as taken is the record. When it turns out wrong, append a correction — `## Correction — YYYY-MM-DD (what it corrects)` — rather than rewriting history into something that was never argued.

## The mutable head over the append-only body

A design doc's **head** — title, `Status:`, the decision table, the slice table, any current-state section — is rewritten freely. Its **body** only grows.

The head exists to bound the reading cost of knowing where things stand. Reconstructing the present from an original plus N corrections is not something a reader should have to do, and a reader who has to will stop.

There is no syntactic boundary to look for. A `---` is usually just a separator. Read for where the argument starts.

## Claims about the tree are checked, or marked

**A doc that says a path, gate, command or constant exists is making a factual claim about the tree.** Present-tense prose about machinery is trusted and acted on, so a stale claim is worse than silence: it sends the next author to build against something that is not there, and lets a reviewer accept it as an answer.

Write what the tree does. Mark anything else.

| Marker | Means | Use for |
|---|---|---|
| `<!-- intent -->` | designed, not built | a path a decision proposes and no commit has created |
| `<!-- runtime -->` | correctly absent from git | build output, operator-owned files, anything `.gitignore` excludes on purpose |
| `<!-- absent -->` | named *because* it does not exist | a stale-path measurement, a rejected alternative, a recorded deletion |

Ordered by tense: `intent` should exist later, `runtime` exists on a real machine but not in git, `absent` exists nowhere and the sentence says so. `absent` is the narrowest — it is honest only when a reader who deleted the marker would still read the line as asserting the path is gone.

A marker covers **the line that carries it**. No marker is not a way to silence a path that is simply stale; that is an edit, not a marker.

A path in **another repo** takes no marker. Qualify it — `davemo88/swarm-spec:docs/chuggy-charter.md` — or write the generic form.

**Use the markers from the first doc.** The gate that reads them is pending, and the convention is not: a gate arriving to a tree that already complies is the cheap version of this, and it is available exactly once.

## One definition per concept

A concept is defined in one doc and mentioned freely everywhere else. `concepts.md` is the routing table that says which doc owns each term.

**A mention is free.** What the rule forbids is a second *definition* — the same term explained twice, in two places, in words that will diverge. `CLAUDE.md` is held to this too, and needs no exemption: it glosses and links by design, and a gloss is a mention.

## The catalogue

`docs/README.md` holds one row per tracked `docs/**/*.md`, including itself.

**Adding a document is two acts, the file and its row.** The second is the one everyone forgets, which is why it is gated both ways once `check-doc-facts.sh` lands: a doc with no row and a row naming no doc are equally a finding.

Prefer editing a doc to adding one. A doc nobody can summarise in one line is a doc worth reconsidering before it merges.

## The gates

| Gate | Runs | Judges | Verdict | Waiting on |
|---|---|---|---|---|
| `doc-lint.sh` | every check, every commit | markdown well-formedness, relative links, design filename shape | **error** | — **live** |
| `check-comments.sh` | every check, every commit | non-doc comments, the two-sentence cap | **error** | its own landing |
| `check-doc-facts.sh` | every check; `--staged` in the hook | paths, restated constants, owned definitions, the catalogue, heading anchors | **error** | its own landing |
| `check-duplication.sh` | every check | copy-paste, threshold 0, tests included | **error** | — **live** |
| `check-shell-quoting.sh` | every check | the `${VAR:-word}` divergence | **error** | — **live** |
| `check-gates.sh` | every check | every gate has a sibling suite | **error** | — **live** |
| `check-model.sh` | every check | the model typechecks, its suites pass, its invariants hold | **error** | — **live** |
| landed-slice resolution | — | `**Landed**` rows against history | **error**, when it can run | a slice table, and an index it can have — see below |
| `doc-staleness.sh` | every check | has a file a doc names moved since the doc did | **advisory** | ~10 docs and ~4 weeks of history |
| orphan check | — | a doc nothing links to | **advisory** | 15 tracked docs |
| `check-molt.sh` | — | the accounting of a shedding | **error**, for that job type | a corpus to shed, and a job type |

**The `Waiting on` column is the point of the table.** A deferral with no recorded trigger becomes permanent, and the difference between "not yet" and "never" is written down here or nowhere.

It only works if a fired trigger is *acted on*. Two slipped once — the duplication and shell-quoting gates were both overdue by several commits before an audit caught them — so an audit of this table against the tree belongs in any change that adds a gate.

Three of these are worth their reasoning:

**Why the staleness ledger reports and does not block.** It answers "is this doc *suspect*", and suspect is not wrong. A check whose output reads as a verdict is a check everyone learns to scroll past — and the predecessor measured that exactly: a path check with a 2% true-positive rate trained every reader, human and agent, to ignore the one line that mattered. It also blocks nothing at the commit, because a staged doc still carries its old commit, so no edit could clear it and the only escape would be `--no-verify`.

**Why the orphan check waits for fifteen docs.** On a corpus of six, nearly everything reads as an orphan. A near-always-true finding burns the ledger's credibility before it has earned any.

**Why landed-slice resolution needs an index it does not have.** It resolves `**Landed** (job #N)` against merge commits that a platform produces. There is no platform yet, so there are no job numbers, and the check would stand down — **silently**, which is the failure mode Tier 3 names: a control that reports success and does nothing. So it is split. Its within-document half — a head reading `Status: IMPLEMENTED` may not leave a row in an unlanded state — needs no index and is live as soon as the gate lands. Its history half prints a stand-down line on every run until the first slice table appears, at which point it gets an index it *can* have under local CI: a `Slice: <design-slug> <row-label>` commit trailer, read from `git log` offline, converging with the platform's job numbers later.

## When a gate cannot run

Every gate exits **0** clean, **1** on a finding, **2** when it could not run. Two is not clean and must never print like it.

A gate whose tooling is missing, whose base cannot be resolved, or which cannot parse a file it was asked to judge reports a linter error and says so. "The check passed" and "the check never ran" are different answers, and conflating them is how a control quietly stops being one.
