# Blessed practices

Three tiers, strictest first. Rules are numeric and mechanical wherever possible, because vague rules erode and numbers do not, and **each rule carries its why inline** — a rule whose reason is elsewhere is a rule that gets argued with.

Keep this document short. It is written to be injected verbatim into a work agent's system prompt, and reviewers reject Tier 1 and Tier 2 violations **by naming the rule**. That contract runs both ways: a rule is a fair rejection only because the author was given this same file.

Adapted from chuggernaut's `docs/reference/style.md`, which is adapted from TigerBeetle's TIGER_STYLE. What is not carried over is recorded at the bottom rather than silently dropped.

## How to read the status tags

Every Tier 1 rule is tagged **live** or **pending**, and a pending rule names what it is waiting for.

A pending rule still binds the author — it is the standard, and code that violates it will be rejected in review. What "pending" means is only that *no script enforces it yet*. Nothing here describes machinery that does not exist; that is the doc-claim rule (`docs.md`) applied to this file, and it is the failure this whole apparatus exists to prevent.

**Why so many rules are pending on day 1, and why that is the point.** This repo adopted its standards before it had code. In the predecessor the order was reversed, and the cost is measurable: its comment ban had to be retrofitted by a job that deleted every comment in the tree; its two-sentence cap is still a ratchet carrying ~500 grandfathered violations; and its module-boundary rule has sat `pending` since the day it was written, because the folder split it presupposes never happened. **A pending rule here converts to live when the thing it governs arrives, in the same commit** — never in the commit after.

---

## Tier 1 — machine-checkable invariants, non-negotiable

| # | Rule | Status | Enforced by |
|---|---|---|---|
| 1 | **No comments except doc comments; a doc comment is at most two sentences.** | pending — lands with `check-comments.sh` | `.chug/tasks/check-comments.sh` |
| 2 | **Markdown is well-formed**: a heading needs a space after `#`, a fence must close, an intra-repo relative link must resolve, and a design filename is `{seq}-{slug}.md`. | **live** | `.chug/tasks/doc-lint.sh` |
| 3 | **Every doc's factual claims about the tree resolve, or are marked.** | pending — lands with `check-doc-facts.sh` | `.chug/tasks/check-doc-facts.sh` |
| 4 | **No duplicated code: zero clones.** | pending — lands with the second gate script | `.chug/tasks/check-duplication.sh` |
| 5 | **No quote inside the word of a `${VAR:-word}` shell expansion.** | pending — lands at three shell scripts | `.chug/tasks/check-shell-quoting.sh` |
| 6 | **Every gate script has a sibling `*.test.sh`.** | pending — lands with the suite runner | `.chug/tasks/check-gates.sh` |
| 7 | **`domain/` reaches no I/O, transitively.** | pending — **lands in the same commit as the folder split** | dependency-cruiser |
| 8 | **`domain/` uses no ambient capability**: no `Date`, `Math.random`, `process`, `fetch`, `setTimeout`, `crypto`. | pending — same commit as rule 7 | eslint, scoped to `src/domain/**` |
| 9 | **Every discriminated union is switched exhaustively**, with `assertNever` in the default arm. | pending — lands with the first union | eslint |
| 10 | **No floating promises.** | pending — lands with the first `async` | eslint |
| 11 | **A function is at most 70 lines**, blank and comment lines excluded. | pending — lands with the eslint config | eslint |
| 12 | **Formatting is the formatter's defaults**, never argued. | pending — lands with `package.json` | prettier |

### Rule 1 — the comment ban

`//`, `/* */` and every trailing-on-a-code-line form are rejected. In TypeScript **`/** */` is the only prose a source file may carry**, and each block stays inside two sentences. Longer than that is a doc: write it under `docs/` and leave a pointer.

*Why:* comments are scattered by construction — nobody reviews them as a body of knowledge, they drift out of step with the code they annotate, and an agent reading the tree cannot tell a current one from a stale one. **Every comment this rule rejects is a sentence that belongs in a doc.**

`///` and `//!` are **not** doc comments in TypeScript. They are Rust syntax; no TS tool reads them, so a `///` block is prose that renders nowhere and the gate rejects it as an ordinary comment.

Two carve-outs. A **module header** — a file's first `/** */` block, stating what the module accepts, emits and guarantees — is exempt from the two-sentence cap; it is registered in the module registry and is structurally unable to scatter. **Machine-read directives** are allowed, and the allowlist is deliberately narrow:

- `jscpd:ignore-start` / `jscpd:ignore-end`, with a reason on the directive line
- `prettier-ignore`
- `@ts-expect-error`, with a description of at least ten characters. **`@ts-ignore` is rejected** — it silences an error that may later become a different error.
- `eslint-disable-next-line` naming a rule **from the allowlist in `check-comments.sh`**. A disable naming a boundary, purity or exhaustiveness rule is rejected outright.

*Why the disable allowlist, which the predecessor does not have:* this tree is written almost entirely by agents, and an agent that cannot satisfy a boundary rule will disable it. A Tier 1 whose disables are unlimited is not a Tier 1.

The allowlist matches the text immediately after the opener, so **a directive is one line**: a wrapped second line is an ordinary comment and the gate rejects it.

*Refutation trigger:* if a legitimate directive form is being rejected more than about once a month, widen the allowlist deliberately — do not weaken the rule.

### Rule 7 — the boundary rule, and the sequencing that makes it real

`src/domain/` must not reach `src/adapters/`, `src/interpret.ts` or any Node builtin **by any path in the module graph**, not merely by direct import. A `domain/util/paths.ts` that imports `node:path` and is used by a decider satisfies every per-file check and violates the invariant, which is why this is a graph rule and not a lint rule.

*Why it is stated now and enforced later:* the predecessor specified this exact rule and never built it, because the split it names never arrived. **The rule that prevents the repeat is a sequencing rule**: the gate lands in the same commit as the directories, with one real file in each. Not the commit after.

---

## Tier 2 — mechanical rules a reviewer checks by name

Concrete enough to verify in seconds, and a reviewer must **name the rule** when rejecting.

There is no automated reviewer yet — the platform that would run one is what this repo is building. Until then Tier 2 binds the author and whoever reads the commit.

1. **Deciders return effects; they never perform them.** A decider is a pure function of an observed view and an event, returning transitions and a list of effects. *Why:* it is what makes the core testable against the model's golden traces without stubbing the world.

2. **Reads are not effects.** A value a decision needs is gathered into the view *before* the decider runs. *Why:* getting this backwards is the commonest way a decider/effects split stops being testable — the decider acquires an await, and then a mock.

3. **Everything is bounded.** Every loop, queue, retry, buffer and recursion has an explicit limit. *Why:* an unbounded anything is an outage with a delay on it.

4. **Assert liberally in domain code** — arguments, postconditions, and the invariants a function claims to preserve. Assert the negative space too: that the thing which must *not* happen did not. *Why:* an assertion is an invariant that runs.

5. **Naming.** Units and qualifiers are suffixes in descending significance — `timeoutSecsMax`, not `maxTimeoutSecs`. No abbreviations in identifiers. A helper is prefixed with its caller's name, so the call tree reads from the names alone. *Why:* agent-written code is navigated by grep; predictable names are the index.

6. **Commit messages carry the why; docs carry the knowledge.** A commit message explains why this change, now — the reasoning that would otherwise be a comment. A doc states what is true of the tree. Neither narrates the other. *Why:* the reader of a doc six months from now cannot run `git log` for every sentence.

7. **New behavior lands with a test at the lowest tier that can express it**, and every fix lands with a regression test. *Why:* a bug with no test is a bug that returns.

8. **Contract-first.** Any change to the core names the contract it changes. If the change cannot be expressed that way, the contract it needs does not exist yet, and **writing it is the first commit of the work**. *Why:* the contract is the scope — it is what makes a unit of work safely delegable to an agent.

---

## Tier 3 — principles

These are the standing commitments. Four of them are the charter's, and `architecture.md` holds their statement and argument — named here so a reviewer can cite them, defined there so there is one copy.

- **The measure comes first** — charter standing rule 1.
- **No free re-entry** — charter standing rule 2.
- **Derive, don't store** — charter standing rule 3.
- **Conformance from day one, direction reversed** — charter standing rule 4. The model leads; the implementation grows up against its traces.
- **Single writer.** One journaled actor decides; nothing else writes. See `architecture.md`.
- **Simplicity over performance.** Take the simple shape until a measurement says otherwise. A measurement, not an intuition.
- **Zero technical debt.** Fix it in the change that found it, or file it as work. "Later" is neither.
- **A control that reports success and does nothing is worse than no control.** An unverified control is believed, and a believed control is not checked again. In the predecessor a rule of exactly this shape was false on the one node it mattered for, and stayed believed for eleven days until something measured it.
- **Dependencies need a stated justification.** Each one is a supply chain, an upgrade obligation and a surface. The `domain/` allowlist is deliberately short, and extending it takes an argument in the commit message.

---

## Carried forward, not yet in force

These are the predecessor's rules whose motivating failures belong to machinery this repo does not have yet. They are recorded so they are not re-derived from scratch when the Nomad adapter arrives, and they are **not** in force — stating them as live would be the exact over-claim Tier 3 forbids.

- **Re-derive every host fact inside the namespace that will use it.** Existence, identity and provenance are three separate questions, and reachability-by-uid and which-kernel-execs-it are two more.
- **A tool's outcome measures the tool, not your claim.** A denial with no control identifies no mechanism.
- **A content hash never enters operator-typed config.**

## Deliberately not carried over

- **Performance rules.** The source's ancestor is a database; this is an orchestrator whose latency budget is dominated by the work it launches.
- **`SAFETY:` comment directives.** No `unsafe` in TypeScript.
- **The two-sentence ratchet.** The source grandfathers ~500 over-long doc comments by judging only lines a diff adds. This tree has none, so the cap is absolute — simpler *and* stricter.
