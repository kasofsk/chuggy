/**
 * A panel's freshness stamp: the ticket page, which reads every instant
 * relative, has it hover the instant it was observed; every other page draws it
 * as it always has.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Freshness, FreshnessInstants } from "../app/browser/Freshness.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const observedAtMs = new Date(2026, 7, 27, 10, 19, 5).getTime();

test("a stamp on a page that reads instants relative hovers the instant, to the second", async () => {
  render(
    <FreshnessInstants>
      <Freshness observedAtMs={observedAtMs} />
    </FreshnessInstants>,
  );
  fireEvent.focus(screen.getByText(/ ago$/u));
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "2026-08-27 10:19:05",
  );
});

test("a stamp anywhere else is the label alone", () => {
  const { container } = render(<Freshness observedAtMs={observedAtMs} />);
  expect(container.querySelector("[tabindex]")).toBeNull();
  expect(container.textContent).toMatch(/ ago$/u);
});

test("a stamp never observed has no instant to hover", () => {
  const { container } = render(
    <FreshnessInstants>
      <Freshness observedAtMs={undefined} />
    </FreshnessInstants>,
  );
  expect(container.querySelector("[tabindex]")).toBeNull();
  expect(container.textContent).toBe("never observed");
});
