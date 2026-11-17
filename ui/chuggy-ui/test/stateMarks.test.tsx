/**
 * The console's state and count marks drawn on the two primitives: a state
 * drawn as its mark alone still says its word to assistive technology, every
 * place a ticket's state is drawn takes its tone from the one mapping, and a
 * tab's count is a count badge its name reads.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { phaseRoster } from "../../../src/contract/rosters.ts";
import { EpicGraphSideMark } from "../app/browser/epic/EpicGraphSide.tsx";
import { EpicStatusChip } from "../app/browser/epic/EpicProgress.tsx";
import { SelectorEditedMark } from "../app/browser/settings/threads/SelectorRowsSection.tsx";
import { TicketDependencyChip } from "../app/browser/ticket/TicketStateChip.tsx";
import { TicketStateLabel } from "../app/browser/ticket/TicketStateLabel.tsx";
import { TabNav, TabNavLink } from "../app/browser/ui/TabNav.tsx";
import { copyTextEn } from "../app/copy/catalog.ts";
import { epicStatusLook } from "../app/core/epics.ts";
import {
  ticketStateLabelOf,
  ticketStateStandings,
} from "../app/core/ticketHeader.ts";
import type { TicketStateStanding } from "../app/core/ticketHeader.ts";
import { epicStatusTone, phaseTone } from "../app/core/tones.ts";
import { renderCopied } from "./copied.tsx";
import { styleless } from "./styleless.ts";

vi.mock(
  "@tanstack/react-router",
  async () => await import("./routerLinkStubbed.tsx"),
);

afterEach(() => {
  styleless();
  cleanup();
});

const stateMarksStandings: readonly TicketStateStanding[] = [
  ...ticketStateStandings,
  "Draft",
];

/** The one status badge drawn, read as its tone and the word it says. */
function stateMarksBadge(): { readonly tone: string; readonly word: string } {
  const badges = document.querySelectorAll<HTMLElement>(".status-badge");
  expect(badges).toHaveLength(1);
  const badge = badges[0] as HTMLElement;
  return { tone: badge.dataset["tone"] ?? "", word: badge.textContent };
}

test("a ticket's state drawn as its mark alone still says its word, hidden from the eye only", () => {
  for (const standing of stateMarksStandings) {
    renderCopied(<EpicGraphSideMark standing={standing} />);
    const label = ticketStateLabelOf(standing);
    const badge = document.querySelector<HTMLElement>(".status-badge");
    expect(badge?.hasAttribute("data-compact"), standing).toBe(true);
    expect(stateMarksBadge(), standing).toStrictEqual({
      tone: label.tone,
      word: copyTextEn(label.word),
    });
    expect(
      badge?.querySelector(".visually-hidden")?.textContent,
      standing,
    ).toBe(copyTextEn(label.word));
    cleanup();
  }
});

test("a selector row's edited mark is a compact badge that says its word to assistive technology", () => {
  renderCopied(<SelectorEditedMark />);
  expect(stateMarksBadge()).toStrictEqual({ tone: "live", word: "Edited" });
  const badge = document.querySelector<HTMLElement>(".status-badge");
  expect(badge?.hasAttribute("data-compact")).toBe(true);
  expect(badge?.querySelector(".visually-hidden")?.textContent).toBe("Edited");
});

test("a ticket's label and a dependency's badge are drawn in the same tone for every standing, a phase's the tone every phase is drawn in", () => {
  for (const standing of ticketStateStandings) {
    renderCopied(<TicketStateLabel standing={standing} size="small" />);
    const label = stateMarksBadge();
    cleanup();
    renderCopied(<TicketDependencyChip ticket={4} standing={standing} />);
    const dependency = stateMarksBadge();
    cleanup();
    expect(dependency.tone, standing).toBe(label.tone);
    expect(dependency.word, standing).toBe("#4");
    expect(label.word, standing).toBe(
      copyTextEn(ticketStateLabelOf(standing).word),
    );
  }
  for (const phase of phaseRoster) {
    if (phase === "Pending") continue;
    renderCopied(<TicketStateLabel standing={phase} size="small" />);
    expect(stateMarksBadge().tone, phase).toBe(phaseTone(phase));
    cleanup();
  }
});

test("an epic's status is its badge, in the word and tone the epic mapping gives it", () => {
  for (const status of [
    "empty",
    "not_started",
    "in_progress",
    "attention",
    "done",
  ] as const) {
    renderCopied(<EpicStatusChip status={status} />);
    expect(stateMarksBadge(), status).toStrictEqual({
      tone: epicStatusTone(status),
      word: copyTextEn(epicStatusLook(status).word),
    });
    cleanup();
  }
});

test("a tab's count is a count badge, drawn once and read once in the tab's name", () => {
  renderCopied(
    <TabNav label="Ticket">
      <TabNavLink
        to="/$tenant/$project/tickets/$ticket/runs"
        params={{ tenant: "acme", project: "web", ticket: "7" }}
        count={12}
        countCut
      >
        Runs
      </TabNavLink>
    </TabNav>,
  );
  const tab = screen.getByRole("link", { name: "Runs 12+" });
  expect(
    tab.querySelector('.count-badge [aria-hidden="true"]')?.textContent,
  ).toBe("12+");
  expect(tab.querySelectorAll(".count-badge")).toHaveLength(1);
});
