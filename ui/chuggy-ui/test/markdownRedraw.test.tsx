/**
 * What the report draws again as a text is written: the blocks at its end, and
 * none of the ones above them.
 *
 * A block of code is counted as it is drawn, which is the only place a redraw
 * of a block that did not change can be seen: the document it leaves is the
 * same either way.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type * as Code from "../app/browser/ui/MarkdownCode.tsx";
import { MarkdownReport } from "../app/browser/ui/MarkdownReport.tsx";
import { corpusLongAnswer, corpusReview } from "./markdownCorpus.ts";
import { prefixes } from "./markdownShape.ts";

const draws = vi.hoisted(() => new Map<string, number>());

vi.mock("../app/browser/ui/MarkdownCode.tsx", async (original) => {
  const real = await original<typeof Code>();
  return {
    ...real,
    MarkdownCode: (
      props: Parameters<typeof real.MarkdownCode>[0],
    ): ReactNode => {
      const code = props.code.value;
      draws.set(code, (draws.get(code) ?? 0) + 1);
      return real.MarkdownCode(props);
    },
  };
});

const first =
  "const waitMilliseconds = Math.min(\n  retryBaseMilliseconds * 2 ** attempt,\n  retryCeilingMilliseconds,\n);";
const last = 'set -euo pipefail\npython3 tally/__init__.py "$@" | tee out.log';

/** How often a block of code has been drawn, each time the text being written
 * reaches a length. */
function drawsAsWritten(
  text: string,
  stride: number,
  code: string,
): readonly number[] {
  const seen: number[] = [];
  const view = render(<MarkdownReport text="" bare writing />);
  for (const prefix of prefixes(text, stride)) {
    view.rerender(<MarkdownReport text={prefix} bare writing />);
    seen.push(draws.get(code) ?? 0);
  }
  return seen;
}

beforeEach(() => {
  draws.clear();
});
afterEach(cleanup);

test("a block is drawn while it is at the end of the text, and not again once the text has gone on", () => {
  const stride = 3;
  const seen = drawsAsWritten(corpusReview, stride, first);
  const settledBy = Math.ceil(
    corpusReview.indexOf("The Python helper") / stride,
  );
  expect(seen[settledBy]).toBeGreaterThan(0);
  expect(seen.at(-1)).toBe(seen[settledBy]);
  expect(seen.length - settledBy).toBeGreaterThan(100);
  expect(draws.get(last)).toBeGreaterThan(1);
});

test("a text that stops being written draws again none of the blocks that read the same", () => {
  const view = render(<MarkdownReport text={corpusReview} bare writing />);
  const before = new Map(draws);
  expect(before.get(first)).toBe(1);
  view.rerender(<MarkdownReport text={corpusReview} bare />);
  expect(draws.get(first)).toBe(1);
  expect(draws.get(last)).toBe(before.get(last));
  expect(view.container.querySelectorAll(".run-report-mark")).toHaveLength(0);
});

test("a long answer draws each of its blocks as often as a short one does, however much follows", () => {
  const stride = 31;
  const short = drawsAsWritten(corpusReview, stride, first).at(-1) ?? 0;
  cleanup();
  draws.clear();
  const rounds = corpusLongAnswer.split("## Review of").length - 1;
  const long = drawsAsWritten(corpusLongAnswer, stride, first).at(-1) ?? 0;
  expect(rounds).toBeGreaterThan(5);
  expect(short).toBeGreaterThan(0);
  expect(long).toBeLessThanOrEqual((short + 1) * rounds);
});
