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
import { branchName } from "./labels.ts";
import { ticketFilterStandings } from "./projectTableFilters.ts";
import { runNowStartedAt } from "./runNow.ts";
import type { TicketAction, TicketActionName } from "./ticketActions.ts";
import { ticketLandingPullLabel } from "./ticketLandings.ts";
import type { TicketLanding } from "./ticketLandings.ts";
import type { TicketListStanding } from "./ticketListView.ts";
import type { TicketOffers } from "./ticketOffers.ts";
import type { TicketSlot } from "./ticketSituation.ts";
import { phaseTone } from "./tones.ts";
import type { Tone } from "./tones.ts";

/** Filled is the tone as the ground under inverse ink; tinted is its wash. */
export type TicketStateLabelForm = "Filled" | "Tinted";

/** The mark before the word, so that colour is never the only signal. */
export type TicketStateLabelMark =
  "Dot" | "Slash" | "Spin" | "Alert" | "Check" | "Cross";

export interface TicketStateLabel {
  readonly standing: TicketListStanding;
  readonly word: string;
  readonly tone: Tone;
  readonly form: TicketStateLabelForm;
  readonly mark: TicketStateLabelMark;
}

export function ticketStateLabelOf(
  standing: TicketListStanding,
): TicketStateLabel {
  switch (standing) {
    case "Ready":
      return {
        standing,
        word: "Ready",
        tone: "pass",
        form: "Tinted",
        mark: "Dot",
      };
    case "Blocked":
      return {
        standing,
        word: "Blocked",
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

/** Every standing a state label is drawn for, Pending as the two it reads as. */
export const ticketStateStandings: readonly TicketListStanding[] =
  phaseRoster.flatMap((phase) =>
    phase === "Pending" ? ticketFilterStandings : [phase],
  );

/** Every word a state label says, which a small label's word is as wide as
 * the widest of. */
export const ticketStateWords: readonly string[] = ticketStateStandings.map(
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
      /** The instant the step's run started, which the clock ages. */
      readonly since: string;
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

function ticketDependencyCount(count: number, standing: string): string {
  return `${String(count)} ${standing} ${count === 1 ? "dependency" : "dependencies"}`;
}

/** What a blocked ticket waits on: the dependencies still open, and those
 * revoked, which nothing will ever finish. */
export function ticketUnfinishedLine(open: number, revoked: number): string {
  return [
    ...(open > 0 || revoked === 0
      ? [ticketDependencyCount(open, "unfinished")]
      : []),
    ...(revoked > 0 ? [ticketDependencyCount(revoked, "revoked")] : []),
  ].join(" · ");
}

function ticketHeaderMoving(slot: TicketSlot): TicketHeaderFragment {
  switch (slot.slot) {
    case "Now":
      return {
        fragment: "Running",
        step: slot.running.step,
        since: runNowStartedAt(slot.running.execution, undefined),
      };
    case "NeedsYou":
      return ticketHeaderWords(slot.detail);
    case "Nothing":
      return ticketHeaderNone;
  }
}

function ticketHeaderLinkOf(
  link: TicketLanding["link"],
): TicketHeaderLink | undefined {
  return link === undefined
    ? undefined
    : { href: link.href, label: ticketLandingPullLabel(link) };
}

/** What the newest landing came to: merged into its base, or proposed. */
function ticketHeaderLanded(
  landings: readonly TicketLanding[],
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
          ? "Merged"
          : `Merged into ${base}`,
    link: ticketHeaderLinkOf(newest.link),
  };
}

export function ticketHeaderFragment(
  reads: TicketHeaderFragmentReads,
): TicketHeaderFragment {
  const ticket = reads.ticket;
  switch (reads.standing) {
    case "Ready":
      if (reads.leadDispatches === undefined) return ticketHeaderNone;
      return ticketHeaderWords(
        reads.leadDispatches ? "Waiting for the lead" : "Waiting for dispatch",
      );
    case "Blocked":
      return ticketHeaderWords(
        ticketUnfinishedLine(
          ticket.openDependencies.length,
          ticket.revokedDependencies.length,
        ),
      );
    case "Work":
    case "Evaluation":
    case "Finalization":
      return ticketHeaderMoving(reads.slot);
    case "Escalated":
      return ticket.escalation === undefined
        ? ticketHeaderNone
        : ticketHeaderWords(escalationDetail(ticket.escalation));
    case "Done":
      return ticketHeaderLanded(reads.landings);
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
