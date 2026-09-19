/**
 * Putting a server's verdict on the author's lines.
 *
 * WHAT HAS TEETH IS THE COORDINATE. The server faults a parsed value by JSON
 * pointer and knows nothing of lines; a finding is only useful if it lands on
 * the field it is about, every finding gets its own line, and a pointer the
 * text no longer holds reports no line rather than a confident wrong one.
 */
import { expect, test } from "vitest";

import { editorFindings, pointerPath } from "../app/browser/editor/findings.ts";

const source = [
  "version: 2",
  "title: Example",
  "work: workloads/build.yaml",
  "evaluators:",
  "  - prompt: agents/review.md",
  "",
].join("\n");

test("a pointer addresses the same place a path does", () => {
  expect(pointerPath("/evaluators/0/prompt")).toEqual([
    "evaluators",
    0,
    "prompt",
  ]);
  expect(pointerPath("")).toEqual([]);
});

test("each finding lands on the line its field is written on", () => {
  const placed = editorFindings(
    [
      { path: "/title", message: "must be a string" },
      { path: "/evaluators/0/prompt", message: "must name a catalog file" },
    ],
    source,
  );
  expect(placed.map((finding) => finding.line)).toEqual([2, 5]);
  expect(placed[0]?.message).toBe("/title: must be a string");
});

test("the column is where the value starts, not the start of the line", () => {
  const [placed] = editorFindings([{ path: "/work", message: "no" }], source);
  expect(placed?.line).toBe(3);
  expect(source.split("\n")[2]?.slice((placed?.column ?? 1) - 1)).toBe(
    "workloads/build.yaml",
  );
});

test("a fault about the document itself carries no line", () => {
  const [placed] = editorFindings(
    [{ path: "", message: "catalog document must be a mapping" }],
    source,
  );
  expect(placed?.line).toBeNull();
  expect(placed?.message).toBe("catalog document must be a mapping");
});

test("a pointer the text no longer holds reports no line", () => {
  const [placed] = editorFindings(
    [{ path: "/missing", message: "gone" }],
    source,
  );
  expect(placed?.line).toBeNull();
});
