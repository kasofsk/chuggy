/**
 * A ticket's place in its landing queue as its chip draws it: the merge mark
 * and `position/total`, named in words that say a holder lands next and a
 * waiter waits at its place, each naming the ticket that holds the reference;
 * a total read from a cut read drawn and named as a least; a title rather
 * than a focusable tooltip inside a link; and nothing at all for a ticket in
 * no queue.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { LandingQueueChip } from "../app/browser/ticket/LandingQueueChip.tsx";
import { renderCopied } from "./copied.tsx";

afterEach(cleanup);

const holderWords = "Lands next: #4 holds the target, 1 of 3 in its queue";

const waiterWords = "Waiting 3 of 3 to land: #4 holds the target";

test("a holder's chip draws the merge mark and 1/total, and is named as landing next", () => {
  renderCopied(
    <LandingQueueChip
      place={{
        holding: true,
        position: 1,
        total: 3,
        truncated: false,
        holder: 4,
      }}
    />,
  );
  const chip = screen.getByRole("img", { name: holderWords });
  expect(chip.textContent).toBe("1/3");
  expect(chip.dataset["holding"]).toBe("true");
  expect(
    chip.querySelector(".ticket-run-mark")?.getAttribute("data-mark"),
  ).toBe("Merge");
  expect(chip.getAttribute("tabindex")).toBe("0");
});

test("a waiter's chip draws its position of the total, and is named as waiting behind the holder", () => {
  renderCopied(
    <LandingQueueChip
      place={{
        holding: false,
        position: 3,
        total: 3,
        truncated: false,
        holder: 4,
      }}
    />,
  );
  const chip = screen.getByRole("img", { name: waiterWords });
  expect(chip.textContent).toBe("3/3");
  expect(chip.dataset["holding"]).toBeUndefined();
  expect(chip.className).toContain("pill-queued");
});

test("a place from a cut read draws its total as a least, and names it so", () => {
  renderCopied(
    <LandingQueueChip
      place={{
        holding: false,
        position: 3,
        total: 3,
        truncated: true,
        holder: 4,
      }}
    />,
  );
  const chip = screen.getByRole("img", {
    name: "Waiting 3 of at least 3 to land: #4 holds the target",
  });
  expect(chip.textContent).toBe("3/3+");
});

test("inside a link the chip says its words as a title and takes no focus of its own", () => {
  renderCopied(
    <a href="/">
      <LandingQueueChip
        place={{
          holding: false,
          position: 3,
          total: 3,
          truncated: false,
          holder: 4,
        }}
        inLink
      />
    </a>,
  );
  const chip = screen.getByRole("img", { name: waiterWords });
  expect(chip.getAttribute("title")).toBe(waiterWords);
  expect(chip.hasAttribute("tabindex")).toBe(false);
});

test("a ticket in no queue draws no chip", () => {
  const { container } = renderCopied(<LandingQueueChip place={undefined} />);
  expect(container.innerHTML).toBe("");
});
