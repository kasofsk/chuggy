import assert from "node:assert/strict";
import test from "node:test";
import { elements } from "./domHarness.ts";
import type { TestElement } from "./domHarness.ts";
import { ticketCreationEdited } from "../../ui/console/app/ticketCreation.js";
import { parseDraftInitialization } from "../../ui/console/app/resources.js";
import { ticketCreationInitialization } from "./ticketCreationFixture.ts";

const ticketCreationPresentationModule =
  "../../ui/console/dom/ticketCreationView.js";
const { ticketCreationPage } = (await import(
  ticketCreationPresentationModule
)) as {
  ticketCreationPage: (controller: unknown) => unknown;
};

const initialization = parseDraftInitialization(ticketCreationInitialization);

function controller() {
  const edits: unknown[] = [];
  return {
    edits,
    value: {
      state: {
        creation: ticketCreationEdited(initialization, initialization.defaults),
      },
      edit: (authoring: unknown, brief: unknown) => {
        edits.push({ authoring, brief });
      },
      submit: () => Promise.resolve(),
    },
  };
}

test("the motivation and acceptance criteria fields commit on change, not on every keystroke", () => {
  const fixture = controller();
  const view = ticketCreationPage(fixture.value) as TestElement;
  const textareas = elements(view, "textarea");
  assert.equal(textareas.length, 2);
  for (const textarea of textareas) {
    assert.equal(
      textarea.listeners.has("input"),
      false,
      "a listener on every keystroke forces a full-page redraw that replaces the field and drops focus",
    );
    assert.equal(textarea.listeners.has("change"), true);
  }
});

test("committing the motivation field parses its lines into the authoring edit", () => {
  const fixture = controller();
  const view = ticketCreationPage(fixture.value) as TestElement;
  const [motivation] = elements(view, "textarea");
  assert.ok(motivation);
  motivation.value = "First reason\n\n Second reason ";
  motivation.listeners.get("change")?.({ preventDefault: () => undefined });
  assert.deepEqual(fixture.edits, [
    {
      authoring: initialization.defaults,
      brief: {
        motivation: ["First reason", "Second reason"],
        acceptanceCriteria: ["The change works."],
      },
    },
  ]);
});
