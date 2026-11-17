/**
 * The settings section's one way of saving: a heading under the page's with
 * the line saying what it is for, Save offered only once the draft moved and
 * can be written, saying it is saving while the write is out, and a refusal
 * taking focus as it arrives, at the field it is of or at its line above the
 * actions.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, expect, test } from "vitest";

import { Input } from "../app/browser/ui/Input.tsx";
import { SettingsSection } from "../app/browser/ui/SettingsSection.tsx";
import type { SettingsSectionRefusal } from "../app/browser/ui/SettingsSection.tsx";
import { renderCopied } from "./copied.tsx";
import { turned } from "./screenHarness.tsx";

afterEach(cleanup);

interface Drawn {
  readonly changed?: boolean;
  readonly ready?: boolean;
  readonly saving?: boolean;
  readonly editing?: boolean;
  readonly refusal?: SettingsSectionRefusal;
  /** The error drawn beside the section's one field. */
  readonly fieldError?: string;
}

function Section(props: Drawn): ReactNode {
  const [value, setValue] = useState("40");
  return (
    <SettingsSection
      title="Limits"
      about="What one decision may spend."
      editing={props.editing ?? true}
      editable
      changed={props.changed ?? false}
      {...(props.ready === undefined ? {} : { ready: props.ready })}
      saving={props.saving ?? false}
      refusal={props.refusal}
      footLead={null}
      onEdit={() => undefined}
      onCancel={() => undefined}
      onSave={() => undefined}
    >
      <Input
        labelShown
        label="Tool calls"
        value={value}
        {...(props.fieldError === undefined ? {} : { error: props.fieldError })}
        onChange={setValue}
      />
    </SettingsSection>
  );
}

function draw(drawn: Drawn = {}): { readonly redraw: (next: Drawn) => void } {
  const view = renderCopied(<Section {...drawn} />);
  return {
    redraw: (next) => {
      view.rerender(<Section {...next} />);
    },
  };
}

function saveButton(name = "Save changes"): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name });
}

test("a section is headed at the level under the page's, with the one line saying what it is for", () => {
  draw();
  const heading = screen.getByRole("heading", { name: "Limits" });
  expect(heading.tagName).toBe("H2");
  expect(screen.getByRole("region", { name: "Limits" }).textContent).toContain(
    "What one decision may spend.",
  );
});

test("Save is offered only once the draft moved and can be written", () => {
  const drawn = draw({ changed: false });
  expect(saveButton().disabled).toBe(true);
  drawn.redraw({ changed: true });
  expect(saveButton().disabled).toBe(false);
  drawn.redraw({ changed: true, ready: false });
  expect(saveButton().disabled).toBe(true);
});

test("while its write is out, Save says it is saving and takes no second press", () => {
  draw({ changed: true, saving: true });
  const save = saveButton("Saving…");
  expect(save.disabled).toBe(true);
  expect(save.getAttribute("aria-busy")).toBe("true");
});

test("a section drawn closed while its write is out says it is saving", () => {
  draw({ editing: false, saving: true });
  expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull();
  expect(screen.getByText("Saving…")).toBeDefined();
});

test("a refusal of no one field is drawn above the actions and takes focus as it arrives", async () => {
  const drawn = draw({ changed: true });
  await turned(() => {
    drawn.redraw({
      changed: true,
      refusal: {
        at: "Section",
        refused: new Error("Server error"),
        line: <span>Server error</span>,
      },
    });
  });
  const line = screen.getByText("Server error").parentElement;
  expect(document.activeElement).toBe(line);
  const foot = document.querySelector("footer.panel-foot");
  expect(
    line !== null &&
      foot !== null &&
      (line.compareDocumentPosition(foot) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
  ).toBe(true);
});

test("a refusal of a field moves focus to that field's control", async () => {
  const drawn = draw({ changed: true });
  await turned(() => {
    drawn.redraw({
      changed: true,
      fieldError: "Whole number",
      refusal: { at: "Field", refused: new Error("Whole number") },
    });
  });
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Tool calls" }),
  );
});

test("focus moves once per refusal, not again as the section redraws", async () => {
  const refusal: SettingsSectionRefusal = {
    at: "Section",
    refused: new Error("Server error"),
    line: <span>Server error</span>,
  };
  const drawn = draw({ changed: true });
  await turned(() => {
    drawn.redraw({ changed: true, refusal });
  });
  const box = screen.getByRole("textbox", { name: "Tool calls" });
  box.focus();
  await turned(() => {
    fireEvent.change(box, { target: { value: "41" } });
    drawn.redraw({ changed: true, refusal });
  });
  expect(document.activeElement).toBe(box);
});
