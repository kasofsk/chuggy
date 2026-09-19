/**
 * The reference layer of the ticket editor, over documents rather than a view.
 *
 * WHAT HAS TEETH IS THAT A REFERENCE IS A PLACE, NOT A STRING. A path is only
 * a reference where the catalog holds that file, materializing one refuses if
 * the text moved under it, and completion is offered only for the directory
 * the field it sits in accepts.
 */
import { EditorState } from "@codemirror/state";
import type { CompletionContext } from "@codemirror/autocomplete";
import { expect, test } from "vitest";
import {
  fragmentCompletion,
  materializedYaml,
  referenceNodes,
} from "../app/browser/editor/fragments.ts";

const files = [
  "workloads/work.yaml",
  "evaluation-plans/review.yaml",
  "agents/work.md",
];

const document = [
  "version: 2",
  "title: Example",
  "work: workloads/work.yaml",
  "evaluation: evaluation-plans/review.yaml",
  "finalization: finalizers/pull-request.yaml",
  "",
].join("\n");

test("only a path the catalog holds is a reference, and it carries its place", () => {
  const found = referenceNodes(document, files);
  expect(found.map((entry) => entry.reference)).toEqual([
    "workloads/work.yaml",
    "evaluation-plans/review.yaml",
  ]);
  expect(found.map((entry) => entry.path)).toEqual([["work"], ["evaluation"]]);
  expect(document.slice(found[0]?.from, found[0]?.to)).toBe(
    "workloads/work.yaml",
  );
});

test("materializing replaces the reference with the mapping it stood for", () => {
  const entry = referenceNodes(document, files)[0];
  expect(entry).toBeDefined();
  if (entry === undefined) return;
  const materialized = materializedYaml(
    document,
    entry,
    "prompt: agents/work.md\nresult_contract: contract\n",
  );
  expect(materialized).toContain("prompt: agents/work.md");
  expect(materialized).not.toContain("work: workloads/work.yaml");
  expect(materialized).toContain("evaluation: evaluation-plans/review.yaml");
});

test("materializing refuses a document whose reference has moved", () => {
  const entry = referenceNodes(document, files)[0];
  expect(entry).toBeDefined();
  if (entry === undefined) return;
  expect(() =>
    materializedYaml("version: 2\nwork: other.yaml\n", entry, "prompt: run\n"),
  ).toThrow(/Reference changed/u);
});

/** Completion reads only the document and the caret, which is all a case needs. */
function completionAt(text: string): CompletionContext {
  return {
    state: EditorState.create({ doc: text }),
    pos: text.length,
  } as CompletionContext;
}

test("completion offers the directory the field accepts and nothing else", () => {
  const offered = fragmentCompletion(files)(completionAt("work: work"));
  expect(offered).not.toBeNull();
  expect(
    offered === null || offered instanceof Promise
      ? []
      : offered.options.map((option) => option.label),
  ).toEqual(["workloads/work.yaml"]);
  expect(fragmentCompletion(files)(completionAt("title: work"))).toBeNull();
});
