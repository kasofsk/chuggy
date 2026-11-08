/**
 * The authoring section's words: a catalog form names its pickers by the
 * terms, a workload's skeleton is code with only its placeholders copy, and
 * under the pseudo wording neither the form nor its editor keeps English of
 * its own.
 */

import { EditorState } from "@codemirror/state";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { chugEditorPhrasesIn } from "../app/browser/editor/chugEditor.ts";
import { ticketYamlWorkloadUnset } from "../app/browser/editor/ticketYamlWorkloads.ts";
import { copyCatalogEn, copyTextEn } from "../app/copy/catalog.ts";
import { copyTextOf } from "../app/copy/copyBundle.ts";
import {
  copyPseudoBundleOf,
  copyPseudoLocale,
} from "../app/copy/copyPseudo.ts";
import { CopyProvider } from "../app/copy/CopyProvider.tsx";
import { answeringApi } from "./answeringApi.ts";
import { renderCopied } from "./copied.tsx";
import { creationFormDrawn } from "./creationFormDrawn.tsx";
import { creationCatalogOffer } from "./ticketCreationFixture.ts";

afterEach(() => {
  cleanup();
});

const ports = answeringApi(() => ({ status: 200, body: {} })).ports;

test("a catalog form names its pickers Work, Evaluation and Landing", () => {
  renderCopied(creationFormDrawn(ports, [creationCatalogOffer()]));
  for (const picker of ["Work", "Evaluation", "Landing"])
    expect(screen.getAllByText(picker).length).toBeGreaterThan(0);
  expect(screen.queryByText("Finalizer")).toBeNull();
});

test("a workload's skeleton keeps its lines as code and words only its placeholders", () => {
  const commands = { runner: "Commands" };
  const plain = ticketYamlWorkloadUnset(commands, copyTextEn) ?? "";
  expect(plain).toContain("- path: <a path in the working directory>");
  expect(plain).not.toContain("workspace");
  const pseudo =
    ticketYamlWorkloadUnset(
      commands,
      copyTextOf(copyPseudoBundleOf(copyCatalogEn)),
    ) ?? "";
  expect(pseudo).toContain("  files:\n");
  expect(pseudo).toContain("- path: <");
  expect(pseudo).toContain("mayCompleteTask: true");
  expect(pseudo).not.toContain("working directory");
});

test("under the pseudo wording the form draws none of its own English", () => {
  render(
    <CopyProvider wording={copyPseudoLocale}>
      {creationFormDrawn(ports, [creationCatalogOffer()])}
    </CopyProvider>,
  );
  const pseudo = copyTextOf(copyPseudoBundleOf(copyCatalogEn));
  expect(
    screen.getByPlaceholderText(
      pseudo({ id: "ticket-authoring-intent-placeholder" }),
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create ticket" })).toBeNull();
  expect(screen.queryByPlaceholderText("what this ticket is for")).toBeNull();
  expect(screen.queryByText("Landing")).toBeNull();
  expect(screen.queryByText("Title")).toBeNull();
});

test("the editor's own phrases are the catalog's, a count still put where it asks", () => {
  const phrased = (text: Parameters<typeof chugEditorPhrasesIn>[0]) =>
    EditorState.create({
      extensions: EditorState.phrases.of(chugEditorPhrasesIn(text)),
    });
  const plain = phrased(copyTextEn);
  expect(plain.phrase("Fold line")).toBe("Fold line");
  expect(plain.phrase("replaced $ matches", 3)).toBe("replaced 3 matches");
  const pseudo = phrased(copyTextOf(copyPseudoBundleOf(copyCatalogEn)));
  expect(pseudo.phrase("Fold line")).not.toMatch(/[A-Za-z]/u);
  expect(pseudo.phrase("replaced $ matches", 3)).toContain("3");
  expect(pseudo.phrase("replaced $ matches", 3)).not.toContain("matches");
});
