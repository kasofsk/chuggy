/**
 * The ticket form as its first screen draws it: what a ticket cannot be filed
 * without, everything else under one disclosure that says what it holds and is
 * marked while any of it holds a value a fresh form would not, one primary
 * action, and a refused submit answered at the first field at fault, with the
 * disclosure opened where that field is inside it. What a submit sends is the
 * body the core assembles from the same form.
 */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import {
  creationBodyFrom,
  creationBranchPrefixedSentence,
  creationFaultSentence,
} from "../app/core/ticketCreation.ts";
import { answeringApi } from "./answeringApi.ts";
import { renderCopied } from "./copied.tsx";
import { creationFormDrawn } from "./creationFormDrawn.tsx";
import { creationMoreOpened, creationMoreTrigger } from "./creationMore.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  creationBinding,
  creationDraft,
  creationForm,
  creationOffers,
} from "./ticketCreationFixture.ts";

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const binding = creationBinding("https://forge.test/acme/atlas.git");

/** An API that makes the draft and then leaves its release pending, so a
 * case reads what was sent and nothing after it. */
function api() {
  return answeringApi((method, path) => {
    if (method === "POST" && path.endsWith("/drafts"))
      return { status: 201, body: creationDraft };
    return { status: 200, body: {} };
  });
}

function draw(ports = api().ports): void {
  renderCopied(
    creationFormDrawn(ports, creationOffers, {
      context: {
        context: "Ready",
        offers: creationOffers,
        partial: false,
        repositories: [binding],
      },
    }),
  );
}

function intentBox(): HTMLElement {
  return screen.getByRole("textbox", { name: "Intent" });
}

function typed(box: HTMLElement, value: string): void {
  fireEvent.change(box, { target: { value } });
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
}

/** The text of every element that describes `element`, in order. */
function describedTexts(element: HTMLElement): readonly string[] {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "");
}

test("the first screen holds the configuration, the intent and the repository, and the rest is under a closed disclosure that says what it holds", () => {
  draw();
  const trigger = creationMoreTrigger();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(describedTexts(trigger)).toStrictEqual([
    copyTextEn({ id: "ticket-authoring-more-about" }),
  ]);
  expect(screen.getAllByRole("textbox").map((box) => box)).toStrictEqual([
    intentBox(),
  ]);
  expect(screen.getByRole("button", { name: /^Repository/u })).toBeDefined();
  expect(screen.queryByRole("radiogroup", { name: "Landing" })).toBeNull();
  expect(screen.queryByText("Evaluators per stage")).toBeNull();
});

test("each field is named by the label drawn over it", () => {
  draw();
  creationMoreOpened();
  for (const name of ["Intent", "Title", "Branch", "Target branch"]) {
    const box = screen.getByRole("textbox", { name });
    expect(box.tagName, name).toMatch(/^(INPUT|TEXTAREA)$/u);
    const label = document.querySelector(`label[for="${box.id}"]`);
    expect(label?.textContent, name).toContain(name);
  }
  const repository = screen.getByRole("button", { name: /^Repository/u });
  expect(repository.id).not.toBe("");
  expect(
    document.querySelector(`label[for="${repository.id}"]`)?.textContent,
  ).toBe("Repository");
  expect(screen.getByRole("textbox", { name: "Branch" })).toBe(
    screen.getByLabelText("Branch"),
  );
  expect(
    describedTexts(screen.getByRole("textbox", { name: "Branch" })),
  ).toHaveLength(1);
});

test("the form offers one primary action, and says once that a ticket can be asked for in the chat", () => {
  const { container } = renderCopied(
    creationFormDrawn(api().ports, creationOffers),
  );
  creationMoreOpened();
  expect(container.querySelectorAll(".btn-primary")).toHaveLength(1);
  expect(
    screen.getAllByText(copyTextEn({ id: "ticket-authoring-chat-line" })),
  ).toHaveLength(1);
});

test("a submit refused at the intent moves the focus to it, binds the reason to it, and leaves the disclosure closed", () => {
  draw();
  submit();
  const intent = intentBox();
  expect(document.activeElement).toBe(intent);
  expect(intent.getAttribute("aria-invalid")).toBe("true");
  expect(describedTexts(intent)).toContain(
    copyTextEn(creationFaultSentence("intent")),
  );
  expect(creationMoreTrigger().getAttribute("aria-expanded")).toBe("false");
});

test("a submit refused first inside the disclosure opens it and moves the focus to that field, which the reader may close again", () => {
  draw();
  typed(intentBox(), "ship it");
  creationMoreOpened();
  typed(screen.getByRole("textbox", { name: "Branch" }), "refs/heads/topic");
  fireEvent.click(creationMoreTrigger());
  expect(creationMoreTrigger().getAttribute("aria-expanded")).toBe("false");
  submit();
  const branch = screen.getByRole("textbox", { name: "Branch" });
  expect(creationMoreTrigger().getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(branch);
  expect(branch.getAttribute("aria-invalid")).toBe("true");
  expect(describedTexts(branch)).toContain(
    copyTextEn(creationBranchPrefixedSentence),
  );
  fireEvent.click(creationMoreTrigger());
  expect(creationMoreTrigger().getAttribute("aria-expanded")).toBe("false");
});

test("a refusal at the intent and inside the disclosure is answered at the intent", () => {
  draw();
  creationMoreOpened();
  typed(screen.getByRole("textbox", { name: "Branch" }), "refs/heads/topic");
  fireEvent.click(creationMoreTrigger());
  submit();
  expect(document.activeElement).toBe(intentBox());
  expect(creationMoreTrigger().getAttribute("aria-expanded")).toBe("false");
});

test("the disclosure is marked while a field under it holds a value a fresh form would not", () => {
  draw();
  const mark = copyTextEn({ id: "ticket-authoring-more-held" });
  expect(creationMoreTrigger().textContent).not.toContain(mark);
  creationMoreOpened();
  const title = screen.getByRole("textbox", { name: "Title" });
  typed(title, "Ship it");
  expect(creationMoreTrigger().textContent).toContain(mark);
  fireEvent.click(creationMoreTrigger());
  expect(
    screen.getByRole("button", { name: `More options ${mark}` }),
  ).toBeDefined();
  creationMoreOpened();
  typed(screen.getByRole("textbox", { name: "Title" }), "");
  expect(creationMoreTrigger().textContent).not.toContain(mark);
  typed(intentBox(), "only the essentials move");
  expect(creationMoreTrigger().textContent).not.toContain(mark);
});

test("what a submit sends is the body the core assembles from the same form", async () => {
  const held = api();
  draw(held.ports);
  typed(intentBox(), "ship it");
  creationMoreOpened();
  typed(screen.getByRole("textbox", { name: "Title" }), "Ship it");
  fireEvent.click(screen.getByRole("button", { name: "Add link" }));
  typed(
    screen.getByRole("textbox", { name: "Link 1" }),
    "https://forge.test/acme/atlas/issues/1",
  );
  typed(screen.getByRole("textbox", { name: "Branch" }), "topic");
  submit();
  await waitFor(() => {
    expect(held.sent.some((one) => one.path.endsWith("/drafts"))).toBe(true);
  });
  const assembled = creationBodyFrom(
    creationOffers,
    creationForm(
      {
        title: "Ship it",
        links: ["https://forge.test/acme/atlas/issues/1"],
        branchName: "topic",
      },
      [binding],
    ),
    [binding],
  );
  if (assembled.assembled !== "Body") throw new Error("the form is refused");
  expect(
    held.sent.find((one) => one.path.endsWith("/drafts"))?.body,
  ).toStrictEqual(assembled.body);
});
