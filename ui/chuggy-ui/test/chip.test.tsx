/**
 * The chip over both its shapes: one that stands, drawn as the neutral pill
 * with no control, and one that can be taken away, ending in a button named by
 * its caller that removes it only while it may. Then the ticket list's state
 * chips, the row's and each count's, as the small state label at its one
 * width.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, expect, test, vi } from "vitest";

import {
  TicketStateChip,
  TicketStateCount,
} from "../app/browser/ticket/TicketStateChip.tsx";
import { TicketStateLabel } from "../app/browser/ticket/TicketStateLabel.tsx";
import { Chip } from "../app/browser/ui/Chip.tsx";
import { Pill } from "../app/browser/ui/Pill.tsx";
import listSheet from "../app/browser/ProjectTable.css?raw";
import ticketSheet from "../app/browser/ticket/ticket.css?raw";
import { copyTextEn } from "../app/copy/catalog.ts";
import { ticketStateWords } from "../app/core/ticketHeader.ts";
import type { TicketListStanding } from "../app/core/ticketListView.ts";
import { sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";

afterEach(() => {
  styleless();
  cleanup();
});

test("a standing chip is its words in the neutral pill's look, with no control", () => {
  const view = renderCopied(
    <>
      <Chip>Site admins</Chip>
      <Pill tone="neutral">Default</Pill>
    </>,
  );
  const chip = screen.getByText("Site admins").closest(".chip");
  const pill = screen.getByText("Default");
  expect(chip?.textContent).toBe("Site admins");
  expect(
    pill.className.split(" ").every((name) => chip?.classList.contains(name)),
  ).toBe(true);
  expect(screen.queryByRole("button")).toBeNull();
  expect(view.container.querySelector("[style]")).toBeNull();
});

test("a chip that can be taken away ends in a button named by its caller, which removes it", () => {
  const removed = vi.fn();
  renderCopied(
    <Chip removal={{ name: "Remove Ada from Admins", onRemove: removed }}>
      Ada
    </Chip>,
  );
  const button = screen.getByRole("button", { name: "Remove Ada from Admins" });
  expect(button.closest(".chip")?.firstElementChild?.textContent).toBe("Ada");
  expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  fireEvent.click(button);
  expect(removed).toHaveBeenCalledTimes(1);
});

test("a chip whose removal is disabled keeps its button and removes nothing", () => {
  const removed = vi.fn();
  renderCopied(
    <Chip
      removal={{
        name: "Remove Ada from Admins",
        disabled: true,
        onRemove: removed,
      }}
    >
      Ada
    </Chip>,
  );
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Remove Ada from Admins",
  });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(removed).not.toHaveBeenCalled();
});

const standings: readonly TicketListStanding[] = [
  "Ready",
  "Blocked",
  "Work",
  "Evaluation",
  "Finalization",
  "Escalated",
  "Done",
  "Revoked",
];

/** The state label a chip draws, read off the word it says. */
function stateLabelDrawn(word: string): HTMLElement {
  const label = screen.getByText(word).closest<HTMLElement>(".ticket-state");
  if (label === null) throw new Error(`no state label around ${word}`);
  return label;
}

test("every state's row chip and count is the small label with a mark, and only a moving state's mark spins", () => {
  for (const standing of standings) {
    renderCopied(
      <>
        <TicketStateChip ticket={7} standing={standing} hint={undefined} />
        <TicketStateCount
          standing={standing}
          count={3}
          pressed={false}
          onPress={() => undefined}
        />
      </>,
    );
    const labels = document.querySelectorAll<HTMLElement>(".ticket-state");
    expect(labels, standing).toHaveLength(2);
    for (const label of labels) {
      const mark = label.querySelector("svg.ticket-state-mark");
      expect(label.dataset["size"], standing).toBe("small");
      expect(label.dataset["standing"], standing).toBe(standing);
      expect(mark?.getAttribute("aria-hidden"), standing).toBe("true");
      expect(mark?.childElementCount, standing).toBeGreaterThan(0);
      expect(mark?.hasAttribute("data-spins"), standing).toBe(
        standing === "Work" ||
          standing === "Evaluation" ||
          standing === "Finalization",
      );
    }
    cleanup();
  }
});

test("Ready and Done differ: Ready tinted with its own mark, Done filled with a check", () => {
  renderCopied(
    <>
      <TicketStateChip ticket={7} standing="Ready" hint={undefined} />
      <TicketStateChip ticket={8} standing="Done" hint={undefined} />
    </>,
  );
  const ready = stateLabelDrawn("Ready");
  const done = stateLabelDrawn("Done");
  expect(ready.dataset["form"]).toBe("tinted");
  expect(done.dataset["form"]).toBe("filled");
  expect(ready.querySelector("svg")?.innerHTML).not.toBe(
    done.querySelector("svg")?.innerHTML,
  );
});

test("a ready chip that dispatches is the button around the label, which presses the dispatch", () => {
  const press = vi.fn();
  renderCopied(
    <TicketStateChip
      ticket={7}
      standing="Ready"
      hint={undefined}
      dispatch={{ busy: false, effect: "Starts work", press }}
    />,
  );
  const button = screen.getByRole("button", { name: "Dispatch ticket #7" });
  expect(button.firstElementChild).toBe(stateLabelDrawn("Ready"));
  fireEvent.click(button);
  expect(press).toHaveBeenCalledTimes(1);
});

test("a count is its state's label holding the number, the button that filters", () => {
  const pressed = vi.fn();
  renderCopied(
    <TicketStateCount
      standing="Work"
      count={4}
      pressed={true}
      onPress={pressed}
    />,
  );
  const count = screen.getByRole("button", { name: /^Working/u });
  expect(count.getAttribute("aria-pressed")).toBe("true");
  expect(count.textContent).toBe("Working4");
  expect(stateLabelDrawn("Working").querySelector(".num")?.textContent).toBe(
    "4",
  );
  fireEvent.click(count);
  expect(pressed).toHaveBeenCalledTimes(1);
});

test("every small state label's word is sized by every state's word, whatever its own, and the page's by its own", () => {
  renderCopied(
    <>
      <TicketStateChip ticket={7} standing="Done" hint={undefined} />
      <TicketStateChip ticket={8} standing="Finalization" hint={undefined} />
      <TicketStateCount
        standing="Ready"
        count={3}
        pressed={false}
        onPress={() => undefined}
      />
      <TicketStateLabel standing="Done" size="page" />
    </>,
  );
  const every = ticketStateWords.map(copyTextEn).join("\n");
  expect(
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '.ticket-state[data-size="small"] .ticket-state-word',
      ),
      (word) => [word.textContent, word.dataset["words"]] as const,
    ),
  ).toStrictEqual([
    ["Done", every],
    ["Finalizing", every],
    ["Ready", every],
  ]);
  expect(
    document.querySelector<HTMLElement>(
      '.ticket-state[data-size="page"] .ticket-state-word',
    )?.dataset["words"],
  ).toBeUndefined();
});

test("the words a small label is sized by, and the widest count a count's number is, are laid out unseen and take no height", () => {
  const sizer = sheetRules(ticketSheet, []).find(
    (rule) => rule.selectorText === ".ticket-state-word[data-words]::before",
  );
  expect(sizer?.style.getPropertyValue("content")).toContain(
    "attr(data-words)",
  );
  expect(sizer?.style.getPropertyValue("display")).toBe("block");
  expect(sizer?.style.getPropertyValue("height")).toBe("0px");
  expect(sizer?.style.getPropertyValue("visibility")).toBe("hidden");
  expect(sizer?.style.getPropertyValue("white-space")).toBe("pre");
  const count = sheetRules(listSheet, []).find(
    (rule) =>
      rule.selectorText ===
      "button.ticket-state-count .num[data-widest]::before",
  );
  expect(count?.style.getPropertyValue("content")).toContain(
    "attr(data-widest)",
  );
  expect(count?.style.getPropertyValue("height")).toBe("0px");
  expect(count?.style.getPropertyValue("visibility")).toBe("hidden");
});

test("counts drawn beside each other hold their numbers at the widest one's width", () => {
  renderCopied(
    <>
      <TicketStateCount
        standing="Ready"
        count={3}
        pressed={false}
        countWidest={12}
        onPress={() => undefined}
      />
      <TicketStateCount
        standing="Blocked"
        count={12}
        pressed={false}
        countWidest={12}
        onPress={() => undefined}
      />
    </>,
  );
  expect(
    Array.from(
      document.querySelectorAll<HTMLElement>(".ticket-state-count .num"),
      (number) => [number.textContent, number.dataset["widest"]] as const,
    ),
  ).toStrictEqual([
    ["3", "12"],
    ["12", "12"],
  ]);
});
