/**
 * The epics a ticket names, drawn where it is: one link each, an archived one
 * said so, and nothing for a ticket in none.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { EpicChips } from "../app/browser/EpicChips.tsx";
import { leadPartition } from "./leadFixture.ts";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: {
    readonly to?: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly children?: ReactNode;
  }) => (
    <a
      href={(props.to ?? "/").replace(
        /\$(\w+)/gu,
        (named: string, key: string) => props.params?.[key] ?? named,
      )}
    >
      {props.children}
    </a>
  ),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(cleanup);

test("each epic is a link to its page and an archived one says so", () => {
  render(
    <EpicChips
      partition={leadPartition}
      epics={[
        { number: 7, title: "Billing", visibility: "Active" },
        { number: 9, title: "Search", visibility: "Archived" },
      ]}
    />,
  );
  const chips = screen.getByRole("group", { name: "Epics" });
  expect(
    within(chips).getByRole("link", { name: "Billing" }).getAttribute("href"),
  ).toBe("/acme/atlas/epics/7");
  expect(screen.getByRole("link", { name: "Search (archived)" })).toBeTruthy();
});

test("a ticket in no epic draws nothing", () => {
  const { container } = render(
    <EpicChips partition={leadPartition} epics={undefined} />,
  );
  expect(container.textContent).toBe("");
});
