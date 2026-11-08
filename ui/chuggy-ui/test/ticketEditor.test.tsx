/**
 * The editor as it mounts, and what it reads from the line under the caret.
 *
 * It mounts into a shadow root, so the styles CodeMirror makes at run time
 * never reach the document the served policy governs; and a text it is handed
 * is not reported back as typing, or a discarded text would be kept again the
 * moment it was put back.
 */

import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  chugEditorAsked,
  chugEditorKeyAt,
  chugEditorOffered,
  createChugEditor,
} from "../app/browser/editor/chugEditor.ts";
import TicketEditor from "../app/browser/editor/TicketEditor.tsx";
import type { TicketYamlKey } from "../app/browser/editor/ticketYamlKey.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { copyPseudoLocale } from "../app/copy/copyPseudo.ts";
import { useCopyWording } from "../app/copy/CopyProvider.tsx";
import type { CopyWording } from "../app/copy/CopyProvider.tsx";
import { renderCopied } from "./copied.tsx";

afterEach(cleanup);

test("the editor mounts in a shadow root and adds no style to the document", async () => {
  renderCopied(
    <TicketEditor
      value={"title: x\n"}
      onChange={() => undefined}
      problems={[]}
      vocabulary={[]}
      catalog={undefined}
    />,
  );
  const host = screen.getByRole("group", { name: "Ticket YAML" });
  await waitFor(() => {
    expect(host.shadowRoot?.querySelector(".cm-content")).not.toBeNull();
  });
  expect(host.shadowRoot?.textContent).toContain("title: x");
  expect(document.querySelectorAll("style")).toHaveLength(0);
});

test("a wording chosen redraws the editor's own controls in it and keeps the text", async () => {
  let held: CopyWording | undefined;
  function Chooser(): null {
    held = useCopyWording();
    return null;
  }
  renderCopied(
    <>
      <Chooser />
      <TicketEditor
        value={"program:\n  build: x\n"}
        onChange={() => undefined}
        problems={[]}
        vocabulary={[]}
        catalog={undefined}
      />
    </>,
  );
  const shadow = () =>
    document.querySelector(".ticket-editor-host")?.shadowRoot ?? undefined;
  const folds = () =>
    [...(shadow()?.querySelectorAll(".cm-foldGutter span[title]") ?? [])].map(
      (marker) => marker.getAttribute("title"),
    );
  await waitFor(() => {
    expect(folds()).toContain("Fold line");
  });
  act(() => {
    held?.choose(copyPseudoLocale);
  });
  await waitFor(() => {
    expect(folds()).not.toContain("Fold line");
  });
  expect(folds().length).toBeGreaterThan(0);
  expect(shadow()?.textContent).toContain("build: x");
});

test("a text the handle is given is not reported as typed", () => {
  const typed = vi.fn();
  const host = document.createElement("div");
  const handle = createChugEditor(host.attachShadow({ mode: "open" }), {
    doc: "title: typed\n",
    onChange: typed,
    vim: false,
    vocabulary: [],
    text: copyTextEn,
  });
  handle.setValue("title: given\n");
  expect(handle.getValue()).toBe("title: given\n");
  expect(typed).not.toHaveBeenCalled();
  handle.destroy();
});

test("the caret asks for a key, a value, a list item's value or a stage's key", () => {
  expect(chugEditorAsked("lan", [])).toStrictEqual({ asked: "Key", typed: 3 });
  expect(chugEditorAsked("title: Pu", [])).toStrictEqual({
    asked: "Value",
    key: "title",
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
    place: "Stage",
  });
  expect(chugEditorAsked("intent: |", [])).toBeUndefined();
});

const vocabulary: readonly TicketYamlKey[] = [
  { key: "branch", hint: "where it starts", values: [{ label: "main" }] },
  { key: "title", hint: "its name", values: [] },
  {
    key: "evaluators",
    hint: "how many",
    values: [{ label: "1" }],
    place: "Stage",
  },
];

test("what is offered is the vocabulary's, a stage's keys only in a stage", () => {
  expect(
    chugEditorOffered({ asked: "Key", typed: 0 }, vocabulary).map(
      (option) => option.label,
    ),
  ).toStrictEqual(["branch", "title"]);
  expect(
    chugEditorOffered({ asked: "Nested", typed: 0 }, vocabulary).map(
      (option) => option.apply,
    ),
  ).toStrictEqual(["evaluators: "]);
  expect(
    chugEditorOffered({ asked: "Value", key: "title", typed: 0 }, vocabulary),
  ).toStrictEqual([]);
});

/** A finalization and a workload each write a `mode`, so a nested key is
 * looked up in the place the top-level key above it writes it in. */
test("a finalization's fields are offered under it, and a nested key's values are the place's own", () => {
  const keys: readonly TicketYamlKey[] = [
    { key: "mode", hint: "the worker's mode", values: [], place: "Workload" },
    {
      key: "mode",
      hint: "how a git merge advances",
      values: [{ label: "Push" }],
      place: "Finalization",
    },
    { key: "kind", hint: "its kind", values: [], place: "Finalization" },
  ];
  const offered = (before: string, above: readonly string[]) => {
    const asked = chugEditorAsked(before, above);
    return asked === undefined
      ? []
      : chugEditorOffered(asked, keys).map((option) => option.label);
  };
  expect(offered("  ", ["finalization:"])).toStrictEqual(["mode", "kind"]);
  expect(offered("  ", ["workloads:"])).toStrictEqual(["mode"]);
  expect(
    offered("  mode: ", ["  kind: GitMerge", "finalization:"]),
  ).toStrictEqual(["Push"]);
  expect(offered("    mode: ", ["  build:", "workloads:"])).toStrictEqual([]);
});

test("a nested key's values are its own where a top-level key shares its name", () => {
  const shared: readonly TicketYamlKey[] = [
    { key: "configuration", hint: "which", values: [{ label: "development" }] },
    {
      key: "configuration",
      hint: "which revision",
      values: [{ label: "Pinned" }, { label: "Latest" }],
      place: "Workload",
    },
  ];
  const offered = (before: string, above: readonly string[]) => {
    const asked = chugEditorAsked(before, above);
    return asked === undefined
      ? []
      : chugEditorOffered(asked, shared).map((option) => option.label);
  };
  expect(offered("configuration: ", [])).toStrictEqual(["development"]);
  expect(offered("  configuration: ", ["selection:"])).toStrictEqual([
    "Pinned",
    "Latest",
  ]);
});

test("a hint is found only on the key a pointer rests on", () => {
  expect(chugEditorKeyAt("  - evaluators: 2", 6)).toStrictEqual({
    key: "evaluators",
    from: 4,
    to: 14,
  });
  expect(chugEditorKeyAt("branch: main", 10)).toBeUndefined();
  expect(chugEditorKeyAt("  - 7", 4)).toBeUndefined();
});
