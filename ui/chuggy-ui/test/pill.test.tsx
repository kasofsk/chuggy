/**
 * The pill over its whole roster: every tone draws its word, its own class and
 * a decorative mark.
 *
 * Totality at run time beside the compiler's at build time — the roster is the
 * `const` the component is total over, so a tone the console gains has a case
 * here without one being written.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Pill, pillTones } from "../app/browser/ui/Pill.tsx";

afterEach(cleanup);

test("every tone draws its word and its own class, and the mark is decorative", () => {
  for (const tone of pillTones) {
    const view = render(<Pill tone={tone}>{tone}</Pill>);
    const drawn = screen.getByText(tone);
    expect(drawn.classList.contains("pill")).toBe(true);
    expect(drawn.classList.contains(`pill-${tone}`)).toBe(true);
    expect(drawn.querySelector(".pill-mark")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(view.container.querySelector("[style]")).toBeNull();
    cleanup();
  }
});

test("emphasis is a class beside the tone, not a tone of its own", () => {
  render(
    <Pill tone="parked" emphasis>
      Escalated
    </Pill>,
  );
  const drawn = screen.getByText("Escalated");
  expect(drawn.classList.contains("pill-emphasis")).toBe(true);
  expect(drawn.classList.contains("pill-parked")).toBe(true);
});
