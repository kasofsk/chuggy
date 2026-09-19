/**
 * The reference affordances of the ticket editor, driven through a mounted
 * view rather than over documents.
 *
 * WHAT HAS TEETH IS THAT THE WIDGETS ARE REACHABLE. The document layer is
 * proved next door; what a view adds is that a reference grows buttons, that
 * expanding one draws the file's text below the line, that a reference inside
 * that text can be opened again without leaving the editor, and that
 * materializing from the widget rewrites the document the view holds.
 */
import { afterEach, expect, test, vi } from "vitest";

import { createChugEditor } from "../app/browser/editor/chugEditor.ts";
import type { EditorHandle } from "../app/browser/editor/chugEditor.ts";
import type { FragmentCatalog } from "../app/browser/editor/fragments.ts";

const files = ["workloads/work.yaml", "agents/work.md"];

const document_ = ["version: 2", "work: workloads/work.yaml", ""].join("\n");

const contents: Readonly<Record<string, string>> = {
  "workloads/work.yaml": "prompt: agents/work.md\nresult_contract: contract\n",
  "agents/work.md": "Do the work described here.\n",
};

let mounted: EditorHandle | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  host?.remove();
  host = null;
});

function editorOpen(onError: FragmentCatalog["onError"] = () => undefined): {
  readonly handle: EditorHandle;
  readonly node: HTMLElement;
} {
  const node = document.createElement("div");
  document.body.append(node);
  const catalog: FragmentCatalog = {
    load: (reference) =>
      Promise.resolve({ content: contents[reference] ?? "" }),
    onError,
  };
  const handle = createChugEditor(node, {
    doc: document_,
    onChange: () => undefined,
    vim: false,
    catalog,
  });
  handle.setCatalog(files);
  mounted = handle;
  host = node;
  return { handle, node };
}

function pressed(node: HTMLElement, label: string): HTMLButtonElement {
  const button = node.querySelector(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  (button as HTMLButtonElement).click();
  return button as HTMLButtonElement;
}

test("a reference the catalog holds carries its own actions", () => {
  const { node } = editorOpen();
  expect(
    node.querySelector('button[aria-label="Expand workloads/work.yaml"]'),
  ).not.toBeNull();
  expect(
    node.querySelector('button[aria-label="Materialize workloads/work.yaml"]'),
  ).not.toBeNull();
});

test("expanding draws the file below the line, and nests one level deeper", async () => {
  const { handle, node } = editorOpen();
  pressed(node, "Expand workloads/work.yaml");
  await vi.waitFor(() => {
    expect(node.querySelector(".cm-fragment-content")?.textContent).toContain(
      "result_contract: contract",
    );
  });
  pressed(node, "Preview agents/work.md");
  await vi.waitFor(() => {
    expect(
      node.querySelector(".cm-nested-file-preview")?.textContent,
    ).toContain("Do the work described here.");
  });
  handle.collapseReferences();
  expect(node.querySelector(".cm-fragment-content")).toBeNull();
});

test("materializing from the widget rewrites the document the view holds", async () => {
  const { handle, node } = editorOpen();
  pressed(node, "Materialize workloads/work.yaml");
  await vi.waitFor(() => {
    expect(handle.getValue()).toContain("prompt: agents/work.md");
  });
  expect(handle.getValue()).not.toContain("work: workloads/work.yaml");
});

test("a reference the catalog does not hold grows no actions", () => {
  const { node } = editorOpen();
  mounted?.setCatalog(["agents/work.md"]);
  expect(
    node.querySelector('button[aria-label="Expand workloads/work.yaml"]'),
  ).toBeNull();
});
