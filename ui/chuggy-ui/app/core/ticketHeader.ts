/**
 * The ticket page's header: the state label, the one fragment beside it, and
 * which of the offered actions are its main ones.
 *
 * A FRAGMENT IS A FACT OR NOTHING. Each arm is drawn from a read the page
 * already holds, and where that read is out or says nothing the header draws
 * no fragment rather than a guess.
 */

import { phaseRoster } from "../../../../src/contract/rosters.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";
import { escalationDetail, phaseLabel } from "./codeLabels.ts";
import type { Copy, CopyText } from "./copy.ts";
import { branchName } from "./labels.ts";
import { ticketFilterStandings } from "./projectTableFilters.ts";
import type { RunTimed } from "./runTotals.ts";
import type { TicketAction, TicketActionName } from "./ticketActions.ts";
import { ticketLandingPullLabel } from "./ticketLandings.ts";
import type { TicketLanding } from "./ticketLandings.ts";
import type { TicketListStanding } from "./ticketListView.ts";
import type { TicketOffers } from "./ticketOffers.ts";
import type { TicketSlot } from "./ticketSituation.ts";
import { phaseTone } from "./tones.ts";
import type { Tone } from "./tones.ts";

/** Filled is the tone as the ground under inverse ink; tinted is its wash;
 * outlined is a dashed edge with no ground, for what is not yet a ticket. */
export type TicketStateLabelForm = "Filled" | "Tinted" | "Outlined";

/** The mark before the word, so that colour is never the only signal. */
export type TicketStateLabelMark =
  "Dot" | "Slash" | "Spin" | "Alert" | "Check" | "Cross" | "Pencil";

/** What the page's label names: a ticket's standing, or a draft never
 * released. */
export type TicketStateStanding = TicketListStanding | "Draft";

export interface TicketStateLabel {
  readonly standing: TicketStateStanding;
  readonly word: Copy;
  readonly tone: Tone;
  readonly form: TicketStateLabelForm;
  readonly mark: TicketStateLabelMark;
}

export function ticketStateLabelOf(
  standing: TicketStateStanding,
): TicketStateLabel {
  switch (standing) {
    case "Draft":
      return {
        standing,
        word: { id: "standing-draft" },
        tone: "queued",
        form: "Outlined",
        mark: "Pencil",
      };
    case "Ready":
      return {
        standing,
        word: { id: "standing-ready" },
        tone: "pass",
        form: "Tinted",
        mark: "Dot",
      };
    case "Blocked":
      return {
        standing,
        word: { id: "standing-blocked" },
        tone: "queued",
        form: "Tinted",
        mark: "Slash",
      };
    case "Work":
    case "Evaluation":
    case "Finalization":
      return {
        standing,
        word: phaseLabel(standing),
        tone: phaseTone(standing),
        form: "Filled",
        mark: "Spin",
      };
    case "Escalated":
      return ticketStateFilled(standing, "Alert");
    case "Done":
      return ticketStateFilled(standing, "Check");
    case "Revoked":
      return ticketStateFilled(standing, "Cross");
  }
}

function ticketStateFilled(
  standing: TicketPhase & TicketListStanding,
  mark: TicketStateLabelMark,
): TicketStateLabel {
  return {
    standing,
    word: phaseLabel(standing),
    tone: phaseTone(standing),
    form: "Filled",
    mark,
  };
}

/** Every standing a small state label is drawn for, Pending as the two it
 * reads as. */
export const ticketStateStandings: readonly TicketListStanding[] =
  phaseRoster.flatMap((phase) =>
    phase === "Pending" ? ticketFilterStandings : [phase],
  );

/** Every word a small state label says, which its word is as wide as
 * the widest of. */
export const ticketStateWords: readonly Copy[] = ticketStateStandings.map(
  (standing) => ticketStateLabelOf(standing).word,
);

/** A pull request as the header links it: by its number where its address
 * names one, else by its host. */
export interface TicketHeaderLink {
  readonly href: string;
  readonly label: string;
}

export type TicketHeaderFragment =
  | { readonly fragment: "Words"; readonly words: string }
  | {
      readonly fragment: "Running";
      readonly step: string;
      /** The step's run, whose time and wait the clock ages. */
      readonly run: RunTimed;
    }
  | {
      readonly fragment: "Landed";
      readonly words: string;
      readonly link: TicketHeaderLink | undefined;
    }
  | { readonly fragment: "None" };

export interface TicketHeaderFragmentReads {
  readonly ticket: TicketResponse;
  readonly standing: TicketListStanding;
  /** Whether the project's lead dispatches, absent while its read is. */
  readonly leadDispatches: boolean | undefined;
  readonly slot: TicketSlot;
  readonly landings: readonly TicketLanding[];
}

const ticketHeaderNone = { fragment: "None" } as const;

function ticketHeaderWords(words: string): TicketHeaderFragment {
  return { fragment: "Words", words };
}

/** What a blocked ticket waits on: the dependencies still open, and those
 * revoked, which nothing will ever finish. */
export function ticketUnfinishedLine(
  open: number,
  revoked: number,
  text: CopyText,
): string {
  return [
    ...(open > 0 || revoked === 0
      ? [text({ id: "ticket-header-unfinished", args: { count: open } })]
      : []),
    ...(revoked > 0
      ? [text({ id: "ticket-header-revoked", args: { count: revoked } })]
      : []),
  ].join(" · ");
}

function ticketHeaderMoving(slot: TicketSlot): TicketHeaderFragment {
  switch (slot.slot) {
    case "Now":
      return {
        fragment: "Running",
        step: slot.running.step,
        run: slot.running.execution,
      };
    case "NeedsYou":
      return ticketHeaderWords(slot.detail);
    case "Nothing":
      return ticketHeaderNone;
  }
}

function ticketHeaderLinkOf(
  link: TicketLanding["link"],
  text: CopyText,
): TicketHeaderLink | undefined {
  return link === undefined
    ? undefined
    : { href: link.href, label: ticketLandingPullLabel(link, text) };
}

/** What the newest landing came to: merged into its base, or proposed. */
function ticketHeaderLanded(
  landings: readonly TicketLanding[],
  text: CopyText,
): TicketHeaderFragment {
  const newest = landings.at(-1);
  if (newest?.state !== "Landed" && newest?.state !== "Proposed")
    return ticketHeaderNone;
  const target = newest.detail.proposal?.base ?? newest.detail.targetRef;
  const base = target === undefined ? undefined : branchName(target);
  return {
    fragment: "Landed",
    words:
      newest.state === "Proposed"
        ? newest.word
        : base === undefined
          ? text({ id: "ticket-landing-merged" })
          : text({ id: "ticket-header-merged-into", args: { base } }),
    link: ticketHeaderLinkOf(newest.link, text),
  };
}

export function ticketHeaderFragment(
  reads: TicketHeaderFragmentReads,
  text: CopyText,
): TicketHeaderFragment {
  const ticket = reads.ticket;
  switch (reads.standing) {
    case "Ready":
      if (reads.leadDispatches === undefined) return ticketHeaderNone;
      return ticketHeaderWords(
        text(
          reads.leadDispatches
            ? { id: "ticket-header-waiting-lead" }
            : { id: "ticket-header-waiting-dispatch" },
        ),
      );
    case "Blocked":
      return ticketHeaderWords(
        ticketUnfinishedLine(
          ticket.openDependencies.length,
          ticket.revokedDependencies.length,
          text,
        ),
      );
    case "Work":
    case "Evaluation":
    case "Finalization":
      return ticketHeaderMoving(reads.slot);
    case "Escalated":
      return ticket.escalation === undefined
        ? ticketHeaderNone
        : ticketHeaderWords(text(escalationDetail(ticket.escalation)));
    case "Done":
      return ticketHeaderLanded(reads.landings, text);
    case "Revoked":
      return ticketHeaderNone;
  }
}

/** Where the header offers Duplicate, if it offers it at all. */
export type TicketHeaderDuplicate = "Main" | "Menu" | "None";

/**
 * The header's actions: the main ones, the first of which is the primary
 * button, Revoke for the menu, whether Edit sits beside them, and where
 * Duplicate goes.
 */
export interface TicketHeaderActions {
  readonly main: readonly TicketAction[];
  readonly revoke: TicketAction | undefined;
  readonly editable: boolean;
  readonly duplicate: TicketHeaderDuplicate;
}

/** The main actions in the order the header draws them, the first leading. */
const ticketHeaderMainOrder: readonly TicketActionName[] = [
  "Approve",
  "Decline",
  "Resume",
  "Dispatch",
];

/**
 * The offered actions as the header lays them out. `withheld` are offered
 * actions the page holds back for now, and `duplicates` is whether the reader
 * may start a ticket from this one; a finished ticket with nothing else to
 * offer leads with Duplicate.
 */
export function ticketHeaderActionsOf(
  offers: TicketOffers,
  phase: TicketPhase,
  withheld: readonly TicketActionName[],
  duplicates: boolean,
): TicketHeaderActions {
  const actions =
    offers.offers === "Actions"
      ? offers.actions.filter((action) => !withheld.includes(action.action))
      : [];
  const main = ticketHeaderMainOrder.flatMap((name) =>
    actions.filter((action) => action.action === name),
  );
  const finished = phase === "Done" || phase === "Revoked";
  return {
    main,
    revoke: actions.find((action) => action.action === "Revoke"),
    editable: offers.offers === "Actions" && offers.editable,
    duplicate: !duplicates
      ? "None"
      : finished && main.length === 0
        ? "Main"
        : "Menu",
  };
}
