/**
 * The epics a ticket names, drawn where it is: one link each, its title then
 * its number, named by the whole of both so the cut title is still read; an
 * archived one said so; the same chip in a list row as in the header; and
 * nothing for a ticket in none.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { EpicChips } from "../app/browser/EpicChips.tsx";
import { TicketListRow } from "../app/browser/ProjectTable.tsx";
import type { ProjectTableRow } from "../app/core/projectTableRows.ts";
import { projectPartition } from "./projectFixture.ts";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: {
    readonly to?: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly className?: string;
    readonly title?: string;
    readonly "aria-label"?: string;
    readonly children?: ReactNode;
  }) => (
    <a
      href={(props.to ?? "/").replace(
        /\$(\w+)/gu,
        (named: string, key: string) => props.params?.[key] ?? named,
      )}
      className={props.className}
      title={props.title}
      aria-label={props["aria-label"]}
    >
      {props.children}
    </a>
  ),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(cleanup);

const titleLong =
  "Console theming, design system, and mobile and accessible experience";

/** The chip's parts as drawn, in order: what is cut, then what never is. */
function chipParts(chip: HTMLElement): readonly (string | null)[] {
  return [...chip.children].map((part) => part.textContent);
}

test("each epic is a link to its page and an archived one says so", () => {
  renderCopied(
    <EpicChips
      partition={projectPartition}
      epics={[
        { number: 7, title: "Billing", visibility: "Active" },
        { number: 9, title: "Search", visibility: "Archived" },
      ]}
    />,
  );
  const chips = screen.getByRole("group", { name: "Epics" });
  expect(
    within(chips)
      .getByRole("link", { name: "Billing #7" })
      .getAttribute("href"),
  ).toBe("/acme/atlas/epics/7");
  const archived = screen.getByRole("link", { name: "Search #9 (archived)" });
  expect(archived.getAttribute("title")).toBe("Search #9 (archived)");
  expect(chipParts(archived)).toEqual(["Search", "#9", "(archived)"]);
});

test("the number is drawn after the title, short or long, outside the cut", () => {
  renderCopied(
    <EpicChips
      partition={projectPartition}
      epics={[
        { number: 3, title: "Billing", visibility: "Active" },
        { number: 24, title: titleLong, visibility: "Active" },
      ]}
    />,
  );
  for (const [number, title] of [
    [3, "Billing"],
    [24, titleLong],
  ] as const) {
    const chip = screen.getByRole("link", { name: `${title} #${number}` });
    expect(chipParts(chip)).toEqual([title, `#${number}`]);
    expect(chip.children[0]?.className).toBe("epic-chip-title");
    expect(chip.children[1]?.className).toBe("epic-chip-number");
  }
});

test("the link's name and tooltip carry the whole title and number", () => {
  renderCopied(
    <EpicChips
      partition={projectPartition}
      epics={[{ number: 24, title: titleLong, visibility: "Active" }]}
    />,
  );
  const chip = screen.getByRole("link", { name: `${titleLong} #24` });
  expect(chip.getAttribute("title")).toBe(`${titleLong} #24`);
  expect(chip.getAttribute("href")).toBe("/acme/atlas/epics/24");
});

function rowInEpic(): ProjectTableRow {
  return {
    ticket: 578,
    title: "A ticket",
    repository: undefined,
    creator: undefined,
    owner: undefined,
    phase: "Escalated",
    sequence: 1,
    badge: { id: "codes-escalation-work-failure" },
    executionVerdict: undefined,
    activityAt: "2026-08-26T00:00:00Z",
    openDependencies: [],
    revokedDependencies: [],
    epics: [{ number: 24, title: titleLong, visibility: "Active" }],
  };
}

test("a list row draws its epic's chip as the header does", () => {
  const epics = rowInEpic().epics;
  const header = renderCopied(
    <EpicChips partition={projectPartition} epics={epics} />,
  ).container.querySelector(".epic-chips")?.outerHTML;
  cleanup();
  const { container } = renderCopied(
    <ul>
      <TicketListRow
        row={rowInEpic()}
        standings={new Map()}
        partition={projectPartition}
        nowMs={Date.parse("2026-08-26T01:00:00Z")}
        creatorNames={new Map()}
        queues={undefined}
      />
    </ul>,
  );
  expect(header).toBeDefined();
  expect(container.querySelector(".epic-chips")?.outerHTML).toBe(header);
});

test("a ticket in no epic draws nothing", () => {
  const { container } = renderCopied(
    <EpicChips partition={projectPartition} epics={undefined} />,
  );
  expect(container.textContent).toBe("");
});
