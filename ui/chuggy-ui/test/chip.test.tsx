/**
 * The chip over both its shapes: one that stands, with no control, and one
 * that can be taken away, ending in a button named by its caller that removes
 * it only while it may. Then the ticket list's row state chip, as the state's
 * status badge.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, expect, test, vi } from "vitest";

import { TicketStateChip } from "../app/browser/ticket/TicketStateChip.tsx";
import { Chip } from "../app/browser/ui/Chip.tsx";
import { copyTextEn } from "../app/copy/catalog.ts";
import { ticketStateLabelOf } from "../app/core/ticketHeader.ts";
import type { TicketListStanding } from "../app/core/ticketListView.ts";
import { styleless } from "./styleless.ts";

afterEach(() => {
  styleless();
  cleanup();
});

test("a standing chip is its words with no control, and draws no state's mark", () => {
  const view = renderCopied(<Chip>Site admins</Chip>);
  const chip = screen.getByText("Site admins").closest(".chip");
  expect(chip?.textContent).toBe("Site admins");
  expect(chip?.querySelector("svg")).toBeNull();
  expect(chip?.closest(".status-badge")).toBeNull();
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

/** The status badge a chip draws, read off the word it says. */
function stateLabelDrawn(word: string): HTMLElement {
  const label = screen.getByText(word).closest<HTMLElement>(".status-badge");
  if (label === null) throw new Error(`no status badge around ${word}`);
  return label;
}

test("every state's row chip is its status badge, in the word and tone its label is given", () => {
  for (const standing of standings) {
    renderCopied(<TicketStateChip ticket={7} standing={standing} />);
    const label = ticketStateLabelOf(standing);
    const badge = stateLabelDrawn(copyTextEn(label.word));
    expect(document.querySelectorAll(".status-badge"), standing).toHaveLength(
      1,
    );
    expect(badge.dataset["tone"], standing).toBe(label.tone);
    expect(badge.dataset["size"], standing).toBe("regular");
    expect(badge.hasAttribute("data-compact"), standing).toBe(false);
    cleanup();
  }
});

test("a ready chip that dispatches is the button around the label, which presses the dispatch", () => {
  const press = vi.fn();
  renderCopied(
    <TicketStateChip
      ticket={7}
      standing="Ready"

      dispatch={{ busy: false, offline: false, press }}
    />,
  );
  const button = screen.getByRole("button", { name: "Dispatch ticket #7" });
  expect(button.firstElementChild).toBe(stateLabelDrawn("Ready"));
  fireEvent.click(button);
  expect(press).toHaveBeenCalledTimes(1);
});

test("a ready chip cannot be pressed while its dispatch is going, which it says, nor while this tab is offline", () => {
  const press = vi.fn();
  const { rerender } = renderCopied(
    <TicketStateChip
      ticket={7}
      standing="Ready"

      dispatch={{ busy: true, offline: false, press }}
    />,
  );
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Dispatch ticket #7",
  });
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  rerender(
    <TicketStateChip
      ticket={7}
      standing="Ready"

      dispatch={{ busy: false, offline: true, press }}
    />,
  );
  expect(button.disabled).toBe(true);
  expect(button.hasAttribute("aria-busy")).toBe(false);
  fireEvent.click(button);
  expect(press).not.toHaveBeenCalled();
});

test("a ticket's number is named as it is written, never grouped as a count is", () => {
  renderCopied(
    <TicketStateChip
      ticket={1345}
      standing="Ready"

      dispatch={{
        busy: false,
        offline: false,
        press: vi.fn(),
      }}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Dispatch ticket #1345" }),
  ).toBeDefined();
});
