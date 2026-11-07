/**
 * What the ticket page's header says and offers: the label every state is
 * drawn as, the one fragment beside it or none where no fact backs one, and
 * which offered actions lead.
 */

import { expect, test } from "vitest";

import type { TicketResponse } from "../../../src/contract/responses.ts";
import { phaseRoster } from "../../../src/contract/rosters.ts";
import type { TicketPhase } from "../../../src/contract/rosters.ts";
import type { TicketAction } from "../app/core/ticketActions.ts";
import {
  ticketHeaderActionsOf,
  ticketHeaderFragment,
  ticketStateLabelOf,
  ticketStateStandings,
  ticketStateWords,
} from "../app/core/ticketHeader.ts";
import type { TicketHeaderFragmentReads } from "../app/core/ticketHeader.ts";
import { ticketLandingOf } from "../app/core/ticketLandings.ts";
import { ticketListStandingOf } from "../app/core/ticketListView.ts";
import type { TicketOffers } from "../app/core/ticketOffers.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { ledgerExecution, workIdentity } from "./ticketLedgerFixture.ts";
import { landingConflicted, landingLanded } from "./ticketLandingsFixture.ts";

test("every state is a word, a tone, a form and a mark, the moving ones filled and spinning", () => {
  expect(
    (
      [
        "Ready",
        "Blocked",
        "Work",
        "Evaluation",
        "Finalization",
        "Escalated",
        "Done",
        "Revoked",
      ] as const
    ).map((standing) => {
      const label = ticketStateLabelOf(standing);
      return [label.word, label.tone, label.form, label.mark];
    }),
  ).toStrictEqual([
    ["Ready", "pass", "Tinted", "Dot"],
    ["Blocked", "queued", "Tinted", "Slash"],
    ["Working", "live", "Filled", "Spin"],
    ["Evaluating", "evaluation", "Filled", "Spin"],
    ["Finalizing", "finalization", "Filled", "Spin"],
    ["Escalated", "parked", "Filled", "Alert"],
    ["Done", "pass", "Filled", "Check"],
    ["Revoked", "retired", "Filled", "Cross"],
  ]);
});

test("a draft never released is labelled Draft, outlined and marked with a pencil", () => {
  const label = ticketStateLabelOf("Draft");
  expect([label.word, label.form, label.mark]).toStrictEqual([
    "Draft",
    "Outlined",
    "Pencil",
  ]);
});

function ticket(over: Partial<TicketResponse> = {}): TicketResponse {
  return {
    ticket: 335,
    phase: "Pending",
    sequence: 9,
    ...ticketInstants,
    ...over,
  };
}

function fragmentOf(over: Partial<TicketHeaderFragmentReads>) {
  const read = over.ticket ?? ticket();
  return ticketHeaderFragment({
    ticket: read,
    standing: ticketListStandingOf(read),
    leadDispatches: true,
    slot: { slot: "Nothing" },
    landings: [],
    ...over,
  });
}

test("a ready ticket waits for the lead, or for a dispatch where no lead dispatches, and says nothing while the lead is unread", () => {
  expect(fragmentOf({ leadDispatches: true })).toStrictEqual({
    fragment: "Words",
    words: "Waiting for the lead",
  });
  expect(fragmentOf({ leadDispatches: false })).toStrictEqual({
    fragment: "Words",
    words: "Waiting for dispatch",
  });
  expect(fragmentOf({ leadDispatches: undefined })).toStrictEqual({
    fragment: "None",
  });
});

test("a blocked ticket counts the dependencies still open as unfinished, and names a revoked one as revoked", () => {
  const one = ticket({ openDependencies: [{ ticket: 334, phase: "Work" }] });
  expect(fragmentOf({ ticket: one })).toStrictEqual({
    fragment: "Words",
    words: "1 unfinished dependency",
  });
  const revoked = ticket({ revokedDependencies: [200] });
  expect(fragmentOf({ ticket: revoked })).toStrictEqual({
    fragment: "Words",
    words: "1 revoked dependency",
  });
  const both = ticket({
    openDependencies: [
      { ticket: 334, phase: "Work" },
      { ticket: 336, phase: "Pending" },
    ],
    revokedDependencies: [333],
  });
  expect(fragmentOf({ ticket: both })).toStrictEqual({
    fragment: "Words",
    words: "2 unfinished dependencies · 1 revoked dependency",
  });
});

test("a moving ticket names its step and the run its time is aged from, and nothing where no run is held", () => {
  const execution = ledgerExecution({
    execution: "execution-1",
    task: 1,
    identity: workIdentity(1),
    status: "Running",
    takenAt: "2026-11-06T10:00:00Z",
  });
  const moving = ticket({ phase: "Evaluation" });
  expect(
    fragmentOf({
      ticket: moving,
      slot: {
        slot: "Now",
        running: { execution, step: "review", cycle: 2 },
      },
    }),
  ).toStrictEqual({
    fragment: "Running",
    step: "review",
    run: execution,
  });
  expect(fragmentOf({ ticket: moving })).toStrictEqual({ fragment: "None" });
});

test("an escalated ticket says its escalation in a few words", () => {
  expect(
    fragmentOf({
      ticket: ticket({
        phase: "Escalated",
        escalation: {
          kind: "EvaluationFailureEscalated",
          resumeAt: "ResumeRework",
        },
      }),
    }),
  ).toStrictEqual({ fragment: "Words", words: "Rework budget exhausted" });
});

test("a done ticket names the branch it merged into, not its whole reference", () => {
  const landed = landingLanded(2, "https://github.com/acme/atlas/pull/1314");
  const whole = {
    ...landed,
    proposal:
      landed.proposal === undefined
        ? undefined
        : { ...landed.proposal, baseRef: "refs/heads/main" },
  };
  expect(
    fragmentOf({
      ticket: ticket({ phase: "Done" }),
      landings: [ticketLandingOf(whole)],
    }),
  ).toMatchObject({ words: "Merged into main", link: { label: "PR #1314" } });
});

test("a done ticket says where it merged and links its pull request by number, and nothing where it holds no landing", () => {
  const done = ticket({ phase: "Done" });
  expect(
    fragmentOf({
      ticket: done,
      landings: [
        ticketLandingOf(landingConflicted(1)),
        ticketLandingOf(
          landingLanded(2, "https://github.com/acme/atlas/pull/138"),
        ),
      ],
    }),
  ).toStrictEqual({
    fragment: "Landed",
    words: "Merged into main",
    link: { href: "https://github.com/acme/atlas/pull/138", label: "PR #138" },
  });
  expect(
    fragmentOf({
      ticket: done,
      landings: [
        ticketLandingOf(landingLanded(2, "https://forge.example.test/merge/7")),
      ],
    }),
  ).toMatchObject({ link: { label: "forge.example.test" } });
  expect(fragmentOf({ ticket: done })).toStrictEqual({ fragment: "None" });
  expect(fragmentOf({ ticket: ticket({ phase: "Revoked" }) })).toStrictEqual({
    fragment: "None",
  });
});

/** An action by its name alone, which is all the header lays out by. */
function action(name: TicketAction["action"]): TicketAction {
  return {
    action: name,
    mutation: { mutation: "RevokeTicket", ticket: 335 },
  };
}

function offered(
  names: readonly TicketAction["action"][],
  editable = false,
): TicketOffers {
  return { offers: "Actions", actions: names.map(action), editable };
}

function laid(
  offers: TicketOffers,
  phase: TicketPhase,
  withheld: readonly TicketAction["action"][] = [],
  duplicates = true,
) {
  const actions = ticketHeaderActionsOf(offers, phase, withheld, duplicates);
  return {
    main: actions.main.map((each) => each.action),
    revoke: actions.revoke !== undefined,
    editable: actions.editable,
    duplicate: actions.duplicate,
  };
}

test("the header leads with Dispatch, Resume, or Approve with Decline beside it, and keeps Revoke for its menu", () => {
  expect(laid(offered(["Dispatch", "Revoke"], true), "Pending")).toStrictEqual({
    main: ["Dispatch"],
    revoke: true,
    editable: true,
    duplicate: "Menu",
  });
  expect(laid(offered(["Revoke", "Resume"]), "Escalated")).toStrictEqual({
    main: ["Resume"],
    revoke: true,
    editable: false,
    duplicate: "Menu",
  });
  expect(
    laid(offered(["Decline", "Approve"]), "Finalization").main,
  ).toStrictEqual(["Approve", "Decline"]);
});

test("a Resume the page holds back is not offered, and the header still offers the rest", () => {
  expect(
    laid(offered(["Resume", "Revoke"]), "Escalated", ["Resume"]),
  ).toStrictEqual({
    main: [],
    revoke: true,
    editable: false,
    duplicate: "Menu",
  });
});

test("a finished ticket leads with Duplicate, and a reader who may not author is offered none", () => {
  for (const phase of phaseRoster)
    expect(laid(offered([]), phase).duplicate, phase).toBe(
      phase === "Done" || phase === "Revoked" ? "Main" : "Menu",
    );
  expect(laid(offered([]), "Done", [], false).duplicate).toBe("None");
});

test("an unread offer leads with nothing and offers no edit", () => {
  expect(laid({ offers: "Unread" }, "Escalated")).toStrictEqual({
    main: [],
    revoke: false,
    editable: false,
    duplicate: "Menu",
  });
});

test("the words a small label is sized by are every standing's word, each once", () => {
  expect(ticketStateStandings).toHaveLength(new Set(ticketStateStandings).size);
  expect(new Set(ticketStateStandings)).toStrictEqual(
    new Set([
      "Ready",
      "Blocked",
      "Work",
      "Evaluation",
      "Finalization",
      "Escalated",
      "Done",
      "Revoked",
    ]),
  );
  expect(ticketStateWords).toStrictEqual(
    ticketStateStandings.map((standing) => ticketStateLabelOf(standing).word),
  );
});
