/**
 * The editor as it mounts, and what it reads from the line under the caret.
 *
 * It mounts into a shadow root, so the styles CodeMirror makes at run time
 * never reach the document the served policy governs; and a text it is handed
 * is not reported back as typing, or a discarded text would be kept again the
 * moment it was put back.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  chugEditorAsked,
  chugEditorKeyAt,
  chugEditorOffered,
  createChugEditor,
} from "../app/browser/editor/chugEditor.ts";
import TicketEditor from "../app/browser/editor/TicketEditor.tsx";
import type { TicketYamlKey } from "../app/browser/editor/ticketYaml.ts";

afterEach(cleanup);

test("the editor mounts in a shadow root and adds no style to the document", async () => {
  render(
    <TicketEditor
      value={"title: x\n"}
      onChange={() => undefined}
      problems={[]}
      vocabulary={[]}
    />,
  );
  const host = screen.getByRole("group", { name: "Ticket YAML" });
  await waitFor(() => {
    expect(host.shadowRoot?.querySelector(".cm-content")).not.toBeNull();
  });
  expect(host.shadowRoot?.textContent).toContain("title: x");
  expect(document.querySelectorAll("style")).toHaveLength(0);
});

test("a text the handle is given is not reported as typed", () => {
  const typed = vi.fn();
  const host = document.createElement("div");
  const handle = createChugEditor(host.attachShadow({ mode: "open" }), {
    doc: "title: typed\n",
    onChange: typed,
    vim: false,
    vocabulary: [],
  });
  handle.setValue("title: given\n");
  expect(handle.getValue()).toBe("title: given\n");
  expect(typed).not.toHaveBeenCalled();
  handle.destroy();
});

test("the caret asks for a key, a value, a list item's value or a stage's key", () => {
  expect(chugEditorAsked("lan", [])).toStrictEqual({ asked: "Key", typed: 3 });
  expect(chugEditorAsked("landing: Pu", [])).toStrictEqual({
    asked: "Value",
    key: "landing",
    typed: 2,
  });
  expect(chugEditorAsked("dependencies: [7, ", [])).toStrictEqual({
    asked: "Value",
    key: "dependencies",
    typed: 0,
  });
  expect(chugEditorAsked("  - 8", ["  - 7", "dependencies:"])).toStrictEqual({
    asked: "Value",
    key: "dependencies",
    typed: 1,
  });
  expect(chugEditorAsked("  - ev", ["program:"])).toStrictEqual({
    asked: "Nested",
    typed: 2,
  });
  expect(chugEditorAsked("  - evaluators: ", ["program:"])).toStrictEqual({
    asked: "Value",
    key: "evaluators",
    typed: 0,
  });
  expect(chugEditorAsked("intent: |", [])).toBeUndefined();
});

const vocabulary: readonly TicketYamlKey[] = [
  { key: "landing", hint: "how it lands", values: [{ label: "Push" }] },
  { key: "title", hint: "its name", values: [] },
  {
    key: "evaluators",
    hint: "how many",
    values: [{ label: "1" }],
    nested: true,
  },
];

test("what is offered is the vocabulary's, a stage's keys only in a stage", () => {
  expect(
    chugEditorOffered({ asked: "Key", typed: 0 }, vocabulary).map(
      (option) => option.label,
    ),
  ).toStrictEqual(["landing", "title"]);
  expect(
    chugEditorOffered({ asked: "Nested", typed: 0 }, vocabulary).map(
      (option) => option.apply,
    ),
  ).toStrictEqual(["evaluators: "]);
  expect(
    chugEditorOffered({ asked: "Value", key: "title", typed: 0 }, vocabulary),
  ).toStrictEqual([]);
});

test("a hint is found only on the key a pointer rests on", () => {
  expect(chugEditorKeyAt("  - evaluators: 2", 6)).toStrictEqual({
    key: "evaluators",
    from: 4,
    to: 14,
  });
  expect(chugEditorKeyAt("landing: Push", 11)).toBeUndefined();
  expect(chugEditorKeyAt("  - 7", 4)).toBeUndefined();
});
