/**
 * The Instructions block folds the intent only where it overflows. Layout is
 * the browser's, so the decision is tested apart and the block is driven by an
 * injected measurement.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { TicketResponse } from "../../../src/contract/responses.ts";
import {
  TicketInstructions,
  instructionsOverflow,
} from "../app/browser/ticket/TicketInstructions.tsx";

afterEach(cleanup);

const atlas = { tenant: "acme", project: "atlas" };

const ticket = {
  ticket: 1,
  brief: { intent: "# Do the thing\n\nIn detail.", links: [] },
} as unknown as TicketResponse;

function drawn(measure: () => boolean): void {
  render(
    <TicketInstructions
      partition={atlas}
      state={{ state: "Ready", value: ticket, observedAtMs: 0 }}
      measure={measure}
    />,
  );
}

test("text is long only where its content outgrows its box", () => {
  expect(instructionsOverflow(300, 100)).toBe(true);
  expect(instructionsOverflow(100, 100)).toBe(false);
  expect(instructionsOverflow(101, 100)).toBe(false);
});

test("Show more is drawn only where the text overflows", () => {
  drawn(() => false);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  cleanup();
  drawn(() => true);
  expect(screen.getByRole("button", { name: "Show more" })).toBeDefined();
});

test("the toggle opens the text and then offers to fold it again", () => {
  drawn(() => true);
  const body = document.getElementById("ticket-instructions-body");
  expect(body?.getAttribute("data-open")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(body?.getAttribute("data-open")).toBe("true");
  expect(screen.getByRole("button", { name: "Show less" })).toBeDefined();
});
