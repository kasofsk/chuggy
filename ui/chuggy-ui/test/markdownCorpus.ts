/**
 * Answers as a model writes them, for the suites that hold the report to what
 * it draws of one: whole, at every moment of being written, and read a block
 * at a time.
 *
 * Each is written as lines because half of what they hold is backticks, and
 * each is the shape of a turn the console really carries: a review of a
 * change, a comparison, a how-to, a short reply, and a reply that is one line.
 */

/** A review of a change: findings nested under the files they are in, and
 * fenced code in three languages. */
export const corpusReview = [
  "## Review of `threadLive.ts`",
  "",
  "Overall this is **close**. Two things need fixing before it lands, and one is *optional*.",
  "",
  "### Must fix",
  "",
  "- **The fold drops a late frame.** In `threadLiveHeard`:",
  "  - a `Text` for a block it is not holding is ignored, which is right",
  "  - but a `Block` that repeats is treated as new:",
  "    1. the held text is cleared",
  "    2. the reader sees it typed again",
  "  - see [the fold](https://example.test/fold#L41) for the guard that is missing",
  "- **The retry never backs off.** Each failure reconnects at once.",
  "",
  "  It should wait, and it should give up:",
  "",
  "  ```ts",
  "  const waitMilliseconds = Math.min(",
  "    retryBaseMilliseconds * 2 ** attempt,",
  "    retryCeilingMilliseconds,",
  "  );",
  "  ```",
  "",
  "### Optional",
  "",
  "The Python helper reads more plainly with a comprehension:",
  "",
  "```python",
  "def count_vowels(words: list[str]) -> int:",
  '    return sum(1 for word in words for letter in word if letter in "aeiou")',
  "```",
  "",
  "and the script that calls it should fail loudly:",
  "",
  "```bash",
  "set -euo pipefail",
  'python3 tally/__init__.py "$@" | tee out.log',
  "```",
  "",
  "> **Note** — none of this changes the wire.",
  "> The shapes in `src/contract` are as they were.",
  "",
  "Tracked as [[ticket:41]]. ~~Blocked on the server.~~ Ready once the two above are in.",
].join("\n");

/** A comparison: prose, then a table wider than a pane, with marks in its
 * cells and its columns aligned. */
export const corpusComparison = [
  "Here is how the three options compare. The short version: **B** is the one to take unless cold starts matter.",
  "",
  "| Option | Latency (p50) | Latency (p99) | Cold start | Cost per million | Operational burden | Verdict |",
  "| :--- | ---: | ---: | :---: | ---: | :--- | :--- |",
  "| **A** — `polling` | 420 ms | 2.1 s | none | $0.40 | one cron entry | simplest, slowest |",
  "| **B** — `server-sent events` | 35 ms | 180 ms | ~1 s | $0.55 | a proxy that does not buffer | *recommended* |",
  "| **C** — `websocket` | 30 ms | 150 ms | ~1 s | $0.90 | sticky sessions, a heartbeat, [a broker](https://example.test/broker) | only if it must be two-way |",
  "",
  "Two caveats:",
  "",
  "1. The p99 for **A** is the polling interval, not the server.",
  "2. **C** costs more because every connection is held open, whether or not anything is said on it.",
].join("\n");

/** A how-to: numbered steps that start where they say, each holding code, a
 * fence of tildes, and a longer fence holding a shorter one. */
export const corpusHowTo = [
  "# Setting up the runner",
  "",
  "You need three things installed first: `node`, `docker` and `just`.",
  "",
  "3. Install the dependencies from the root, never from the console:",
  "",
  "   ```sh",
  "   npm ci",
  "   ```",
  "",
  "4. Point git at the hooks. This is per clone:",
  "",
  "   ~~~sh",
  "   just hooks",
  "   ~~~",
  "",
  "   If `just` is missing, the recipe is one line you can run by hand.",
  "",
  "5. Check that it worked:",
  "   - [x] `git config core.hooksPath` prints `.githooks`",
  "   - [ ] the first commit runs the fast gates",
  "",
  "To show a fence inside an answer, write a longer one around it:",
  "",
  "````markdown",
  "```sh",
  "just check",
  "```",
  "````",
  "",
  "---",
  "",
  "#### If it fails",
  "",
  "A gate that exits `2` *could not run*, which is **not** a pass. Read what it printed; each prints its own remedy. More at https://example.test/gates.",
].join("\n");

/** A short reply with nothing in it but words. */
export const corpusPlain = [
  "Yes, that is safe to merge. The only caller is the test, and the test already passes the new argument.",
  "",
  "I would still rename it before the next change touches it.",
].join("\n");

const corpusLongSentence =
  "the reader keeps what it has already read and only looks again at what is new, so the cost of a longer line is the cost of the line and not of everything that came before it; ";

/** A reply that is mostly one very long line, as a model writes when asked
 * for something with no breaks in it. */
export const corpusLongLine = [
  "Here it is as one line, as asked:",
  "",
  `In short, ${corpusLongSentence.repeat(24)}and that is all of it.`,
  "",
  "Say if you want it wrapped.",
].join("\n");

/** Every construct the report draws, one of each, for the suites that walk
 * what the grammar and the writing between them have to get right. */
export const corpusEverything = [
  "# One",
  "## Two",
  "### Three",
  "#### Four",
  "",
  "A paragraph whose line",
  "breaks where its writer broke it, with ***bold italic***, **bold holding `code`**,",
  "**bold holding [a link](https://example.test/a)**, [`code` in a link](https://example.test/b),",
  "~~struck~~, ``code holding a ` backtick``, an escaped \\*star\\*, and <b>tags</b> as text.",
  "",
  "- one",
  "  continued on a second line",
  "- two",
  "",
  "  with a second paragraph",
  "  1. nested and numbered",
  "     - nested again, three deep",
  "  2. and back",
  "- three, with a relative [link](./console/BRIEF.md) and a [script](javascript:alert(1)) that are not links",
  "",
  "7. starts at seven",
  "8. goes on",
  "",
  "> A quote holding a paragraph.",
  ">",
  "> - and a list",
  "> - of two",
  "",
  "***",
  "",
  "| Left | Centre | Right |",
  "| :-- | :-: | --: |",
  "| `a` | **b** | *c* |",
  "",
  "Names such as count_words and __init__.py stay names, and https://example.test/bare is a link.",
].join("\n");

/** How many characters the long answer runs to, at the least. */
export const corpusLongAnswerCharsMin = 30_000;

/** A long answer: the review, the comparison and the how-to, written out again
 * and again until it is as long as a model's longest. */
export const corpusLongAnswer = ((): string => {
  const round = [corpusReview, corpusComparison, corpusHowTo].join("\n\n");
  const rounds = Math.ceil(corpusLongAnswerCharsMin / (round.length + 2));
  return Array.from({ length: rounds }, () => round).join("\n\n");
})();

/** The answers a suite walks, by name. */
export const corpusAnswers: Readonly<Record<string, string>> = {
  review: corpusReview,
  comparison: corpusComparison,
  howTo: corpusHowTo,
  plain: corpusPlain,
  longLine: corpusLongLine,
  everything: corpusEverything,
};
