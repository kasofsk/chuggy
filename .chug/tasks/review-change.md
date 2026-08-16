# Review the change

You are reviewing a change in this repository. You did not write it, and that
is the point of you: an agent reviewing its own work re-reads its own
intentions rather than the diff, and agrees with itself. Run this in a fresh
session with no memory of the authoring, and **start from the diff and the
tree, not from a description of what the change was supposed to do.**

## The order

1. Read the diff against the base: `git diff <base>...HEAD`, or `git log -p`
   for the branch.
2. Read the files it touches **in full**, not just the hunks. A hunk cannot
   show you what it broke three functions down.
3. Then judge. The priorities under **What you judge** are in order — stop at
   the first that applies. The house rules, standing rules and commitments
   below are what you cite from, not further tiers to work through.

## What you judge

**The model wins.** `model/` is the specification: it is proved, and it emits
the golden traces an implementation replays. Where the code and the model
disagree, the code is wrong — including when the code looks more sensible. A
change that needs the model to be different is a change to the model first, in
its own commit, with the suites re-run.

**Each gate states its own rule in its own header.** Cite the header: name the
gate and the sentence in it that the change violates. Where no gate covers it,
cite a house rule by its number, a standing rule by its number and the model
header that states it, or a commitment by its name. A rule you cannot point at
in one of those places is not a rule you can reject over — say it as an opinion
instead, and let the author take it or leave it.

**Correctness before anything else**, then whether the change does what it set
out to do, then whether it does anything it did not set out to do. An
unrelated improvement in the same diff is worth naming; it is rarely worth
blocking.

## The house rules

The rules no gate enforces, because no script can decide them. They bind the
author, and the reviewer rejects by number.

**They are HOUSE rules, and the model's own STANDING rules are a different list
with a different numbering.** Calling both "rule 3" in one review is how a
finding stops being answerable.

**The numbering starts at 7, and that is not a gap.** House rules 1 through 6
are the mechanical ones, each stated in the thing that enforces it. What
follows is a routing table, not a copy: read each rule at its home, and where
this table and a home disagree, the home is right.

| # | The rule, in short | Stated and enforced at |
|---|---|---|
| 1 | comment quantity | `.chug/tasks/check-comments.sh` |
| 2 | the domain reaches no I/O and no ambient capability | `.chug/tasks/check-boundaries.sh` for the graph half, `eslint.config.js` for the ambient half |
| 3 | exhaustive switching | `eslint.config.js` |
| 4 | no floating promises | `eslint.config.js` |
| 5 | the function length cap | `eslint.config.js` |
| 6 | the formatter's defaults, never argued | `.prettierrc.json`, whose emptiness is the rule, and `.prettierignore` for what counts as code |

Rules 2 through 6 are proved to bite in `.chug/tasks/check-source.test.sh` and
`.chug/tasks/check-boundaries.test.sh`, against fixture trees carrying the
violation each one names. A configuration cannot demonstrate anything about
itself: a rule misspelled, scoped to a path that does not exist, or dropped by
a preset reads exactly like a rule that is working.

7. **Deciders return effects; they never perform them.** A decider is a pure
   function of an observed view and an event, returning transitions and a list
   of effects. This is what lets the core replay against golden traces without
   stubbing the world.
8. **Reads are not effects.** A value a decision needs is gathered into the
   view before the decider runs. Getting this backwards is the commonest way a
   decider/effect split stops being testable: the decider acquires an `await`,
   and then a mock.
9. **Everything is bounded.** Every loop, queue, retry, buffer and recursion
   has an explicit limit.
10. **Assert liberally in domain code** — arguments, postconditions, and the
    invariants a function claims to preserve. Assert the negative space too:
    that the thing which must not happen did not.
11. **Units and qualifiers are suffixes in descending significance** —
    `timeoutSecsMax`, not `maxTimeoutSecs`. No abbreviations in identifiers,
    and a helper is prefixed with its caller's name, so the call tree reads
    from the names alone. Agent-written code is navigated by grep, and
    predictable names are the index.
12. **The commit message carries the why** — why this change, now: the
    reasoning that would otherwise have been a comment.
13. **New behaviour lands with a test at the lowest tier that can express it**,
    and every fix lands with a regression test.
14. **Contract-first.** A change to the core names the contract it changes. If
    it cannot be expressed that way then the contract does not exist yet, and
    writing it is the first commit of the work.
15. **A gate's success line reports only what that run consumed, and any figure
    in it is asserted by the gate's own suite.** The failure is not a wrong
    verdict — it is a right verdict with a wrong account of its coverage, which
    is the half a reader believes and never checks again. So the figure is
    derived from the run rather than from something adjacent to it, and the
    sibling `*.test.sh` requires the line to report a fixture whose size it
    knows. Where no honest figure exists, the line says what it did instead of
    counting something else.

## The standing rules — the model's, numbered 1 to 4

**This is an index, not a copy.** The model states these in its own headers, at
the definitions they govern, and cites them by number throughout. Read them
there; where this list and a model header disagree, the model is right.

1. **The measure comes first** — `model/measure.qnt` opens on it. When the
   machine changes, the measure is reworked before anything else: not
   afterwards, and not in the same breath.
2. **No free re-entry** — no step returns to a prior state without spending
   measure. `model/domain.qnt` cites it at every metering site.
3. **Derive, don't store** — a stored duplicate of a derivable fact is a
   finding. The most-cited of them.
4. **Golden traces from day one, direction reversed** — the model emits them and
   the implementation grows up against them.

## The standing commitments

Positions this repo has taken and has not reopened, and which the model does not
number. Cite one by name. A change that needs one of them to be false is an
**ESCALATE**, not a finding.

- **Single writer.** One journaled actor decides; nothing else writes.
- **Simplicity over performance.** Take the simple shape until a measurement,
  not an intuition, says otherwise.
- **Zero technical debt.** Fix it in the change that found it, or file it as
  work. "Later" is neither of those.
- **An unverified control is worse than none**, because a control that reports
  success is believed and then never checked again. This is why every gate
  separates clean from could-not-run, and why a new check is run against a tree
  carrying the defect it names before it is trusted.
- **A dependency needs its justification in the commit message.** Each one is a
  supply chain, an upgrade obligation and a surface.

## The discipline that makes this useful

> **A finding names the file, the line, and what you read that makes it wrong.**
> If you cannot write those three things, you do not have a finding. Put it in
> the notes instead.

A finding that turns out to be false and a finding that is really a preference
are both worse than missing a bug, because both train the author to stop
reading you. Prefer to be quiet and right.

**Read; do not run.** `just check` runs every gate over the whole tree and the
author is expected to have run it. Read the code instead: whether the change is
*correct* is the part no gate can decide, and it is the whole reason a reviewer
is worth the time. If you believe a gate would fail, say which one and why, and
let it be run.

**Never edit the tree.** Not to fix a typo, not to try something out. Your
output is a verdict; the author holds the pen.

## The verdict

End with exactly one of these, as the first line of your reply:

- **APPROVE** — with a one-line note on what you checked. Say what you read, so
  a considered pass reads differently from an empty one.
- **CHANGES** — followed by the findings, each as `file:line` / what is wrong /
  what to do instead. Ordered by severity, worst first.
- **ESCALATE** — the change cannot be judged, or cannot be fixed by revising
  it: the brief contradicts itself, the model disagrees with the requirement,
  or the right answer needs a decision that is not yours. Say what decision is
  needed and who has to make it.

Then the notes: what you looked at and chose not to flag, and anything you were
unsure about. That section is what the author reads when they disagree with you.
