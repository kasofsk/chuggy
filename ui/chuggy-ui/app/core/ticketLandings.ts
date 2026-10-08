/**
 * What a ticket's page draws of its landings: one row a landing under the
 * cycle it belongs to, a fragment on that cycle's header, a fragment on the
 * Work row of the cycle a failed landing opened, and one on the status bar
 * while the ticket is finalizing.
 *
 * THE RESPONSE'S FIELDS ARE READ HERE AND NOWHERE ELSE. Every part of the page
 * is handed `TicketLanding`s, so a field the read renames or drops is one
 * module's change; the states are worded in `codeLabels.ts` and toned in
 * `tones.ts`, where every roster of the wire's is.
 *
 * A LANDING IS NEVER A CYCLE. The ledger's cycles are derived from executions
 * alone, and a landing is joined to one by the cycle it names; a landing whose
 * cycle the ledger does not hold is drawn apart from them, so the current
 * cycle and every count read off the ledger stay what the executions say.
 *
 * A LINK IS OFFERED ONLY FOR AN ADDRESS THAT PARSES AS HTTPS, whatever the
 * contract admits, and an address that does not parse is no link rather than
 * a throw.
 *
 * THE READ IS ASKED AGAIN ON A CLOCK AND ON EVERY FRAME NAMING THE TICKET, and
 * its last answer stands across a read that failed.
 */

import type { TicketLandingsResponse } from "../../../../src/contract/responses.ts";
import type { TicketLandingState } from "../../../../src/contract/rosters.ts";
import {
  changeProposalCreationLabel,
  changeProposalMergeabilityLabel,
  changeProposalMergeLabel,
  changeProposalMergeReasonLabel,
  finalizationFailureKindLabel,
  finalizationUnavailableKindLabel,
  ticketLandingStateLabel,
} from "./codeLabels.ts";
import { agoText } from "./figures.ts";
import type { PanelState } from "./freshness.ts";
import { commitLabel } from "./labels.ts";
import type { Label } from "./labels.ts";
import { countedLabel } from "./runTotals.ts";
import type { TicketDeliveryLink } from "./ticketDelivery.ts";
import { ticketLandingTone } from "./tones.ts";
import type { Tone } from "./tones.ts";

type TicketLandingRead = TicketLandingsResponse["landings"][number];

/**
 * How often the read is asked again while a page draws it. With the slowest
 * answer one request can take it stays inside the console's staleness rule.
 */
export const ticketLandingsPolledMs = 30_000;

/** The list entry the read is kept at, which a frame naming the ticket stales. */
export function ticketLandingsListName(ticket: number): string {
  return `landings:${String(ticket)}`;
}

/** The pull request a landing opened, as its detail draws it. */
export interface TicketLandingProposal {
  readonly head: string;
  readonly base: string;
  readonly creation: string | undefined;
  readonly merge: string | undefined;
  readonly mergeReason: string | undefined;
  readonly mergeability: string | undefined;
  readonly mergeCommit: Label | undefined;
}

/** What a landing's detail holds beyond its row. */
export interface TicketLandingDetail {
  readonly targetRef: string | undefined;
  readonly targetCommit: Label | undefined;
  readonly candidateCommit: Label | undefined;
  readonly preparedAt: string | undefined;
  readonly attempts: number;
  readonly conflicts: readonly string[];
  readonly conflictsCut: boolean;
  readonly proposal: TicketLandingProposal | undefined;
}

/** The hold a landing waits on, and since when. */
export interface TicketLandingHold {
  readonly label: string;
  readonly since: string;
}

/** One landing as every part of the page draws it. */
export interface TicketLanding {
  readonly key: string;
  readonly cycle: number;
  readonly state: TicketLandingState;
  readonly word: string;
  readonly tone: Tone;
  /** Why it failed, where it is a failure that names one. */
  readonly failure: string | undefined;
  readonly conflictCount: number;
  readonly hold: TicketLandingHold | undefined;
  readonly link: TicketDeliveryLink | undefined;
  readonly landedCommit: Label | undefined;
  readonly detail: TicketLandingDetail;
}

/** The read's state with its answer turned into the landings the page draws. */
export type TicketLandingsState = PanelState<readonly TicketLanding[]>;

/** A link where the address parses as https, and none otherwise. */
export function ticketLandingLink(
  url: string | undefined,
): TicketDeliveryLink | undefined {
  if (url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:"
    ? { href: parsed.href, host: parsed.host }
    : undefined;
}

function ticketLandingProposal(
  proposal: TicketLandingRead["proposal"],
): TicketLandingProposal | undefined {
  if (proposal === undefined) return undefined;
  return {
    head: proposal.headRef,
    base: proposal.baseRef,
    creation:
      proposal.creation === undefined
        ? undefined
        : changeProposalCreationLabel(proposal.creation),
    merge:
      proposal.merge === undefined
        ? undefined
        : changeProposalMergeLabel(proposal.merge),
    mergeReason:
      proposal.mergeReason === undefined
        ? undefined
        : changeProposalMergeReasonLabel(proposal.mergeReason),
    mergeability:
      proposal.mergeability === undefined
        ? undefined
        : changeProposalMergeabilityLabel(proposal.mergeability),
    mergeCommit:
      proposal.mergeCommit === undefined
        ? undefined
        : commitLabel(proposal.mergeCommit),
  };
}

function ticketLandingDetail(read: TicketLandingRead): TicketLandingDetail {
  const attempt = read.attempt;
  return {
    targetRef: attempt?.targetRef,
    targetCommit:
      attempt === undefined ? undefined : commitLabel(attempt.targetCommit),
    candidateCommit:
      attempt?.candidateCommit === undefined
        ? undefined
        : commitLabel(attempt.candidateCommit),
    preparedAt: attempt?.preparedAt,
    attempts: read.attempts,
    conflicts: read.conflict?.paths ?? [],
    conflictsCut: read.conflict?.truncated ?? false,
    proposal: ticketLandingProposal(read.proposal),
  };
}

/** One landing of the read, as the page draws it. */
export function ticketLandingOf(read: TicketLandingRead): TicketLanding {
  const failureKind = read.attempt?.failureKind;
  return {
    key: `${String(read.cycle)}/${String(read.generation)}`,
    cycle: read.cycle,
    state: read.state,
    word: ticketLandingStateLabel(read.state),
    tone: ticketLandingTone(read.state),
    failure:
      failureKind === undefined
        ? undefined
        : finalizationFailureKindLabel(failureKind),
    conflictCount: read.conflict?.paths.length ?? 0,
    hold:
      read.state === "Held"
        ? {
            label: finalizationUnavailableKindLabel(read.hold.kind),
            since: read.hold.since,
          }
        : undefined,
    link: ticketLandingLink(read.proposal?.url),
    landedCommit:
      read.state === "Landed" ? commitLabel(read.landedCommit) : undefined,
    detail: ticketLandingDetail(read),
  };
}

/** The read's state with its answer turned into the landings the page draws. */
export function ticketLandingsRead(
  state: PanelState<TicketLandingsResponse>,
): TicketLandingsState {
  return state.state === "Ready"
    ? { ...state, value: state.value.landings.map(ticketLandingOf) }
    : state;
}

/** The landings to draw, which is none while the read has never answered. */
export function ticketLandingsHeld(
  state: TicketLandingsState,
): readonly TicketLanding[] {
  return state.state === "Ready" ? state.value : [];
}

/** How long a held landing has been held, in the age every page reads. */
function ticketLandingHeldFor(hold: TicketLandingHold, nowMs: number): string {
  const sinceMs = Date.parse(hold.since);
  return Number.isFinite(sinceMs)
    ? `Held ${agoText(nowMs, sinceMs)} · ${hold.label}`
    : `Held · ${hold.label}`;
}

/** What a landing's row says beside its pill, as text, a link and a commit. */
export interface TicketLandingFragment {
  readonly text: string | undefined;
  readonly link: TicketDeliveryLink | undefined;
  readonly commit: Label | undefined;
}

/** The one short fragment a landing's row and the status bar carry. */
export function ticketLandingFragment(
  landing: TicketLanding,
  nowMs: number,
): TicketLandingFragment {
  switch (landing.state) {
    case "Failed":
      return {
        text:
          landing.failure === undefined
            ? undefined
            : [
                landing.failure,
                ...(landing.conflictCount > 0
                  ? [countedLabel(landing.conflictCount, "file")]
                  : []),
              ].join(" · "),
        link: undefined,
        commit: undefined,
      };
    case "Held":
      return {
        text:
          landing.hold === undefined
            ? undefined
            : ticketLandingHeldFor(landing.hold, nowMs),
        link: undefined,
        commit: undefined,
      };
    case "Running":
    case "AwaitingApproval":
    case "Proposed":
    case "Landed":
      return {
        text: undefined,
        link: landing.link,
        commit: landing.landedCommit,
      };
    case "Unavailable":
    case "Invalidated":
      return { text: undefined, link: undefined, commit: undefined };
  }
}

/** Whether a fragment says anything at all. */
export function ticketLandingFragmentSays(
  fragment: TicketLandingFragment,
): boolean {
  return (
    fragment.text !== undefined ||
    fragment.link !== undefined ||
    fragment.commit !== undefined
  );
}

/** What a cycle's header says of its newest landing. */
export function ticketLandingSummary(landing: TicketLanding): string {
  return landing.state === "Landed"
    ? landing.word
    : `Landing ${landing.word.toLowerCase()}`;
}

/** The landings joined to the cycles the ledger holds, and those it does not. */
export interface TicketLandingsJoined {
  readonly byCycle: ReadonlyMap<number, readonly TicketLanding[]>;
  readonly unheld: readonly TicketLanding[];
}

/** Each landing under the cycle it names where the ledger holds that cycle, in the read's order. */
export function ticketLandingsJoined(
  landings: readonly TicketLanding[],
  cycles: readonly number[],
): TicketLandingsJoined {
  const held = new Set(cycles);
  const byCycle = new Map<number, readonly TicketLanding[]>();
  const unheld: TicketLanding[] = [];
  for (const landing of landings) {
    if (!held.has(landing.cycle)) {
      unheld.push(landing);
      continue;
    }
    byCycle.set(landing.cycle, [
      ...(byCycle.get(landing.cycle) ?? []),
      landing,
    ]);
  }
  return { byCycle, unheld };
}

/** Why a cycle exists, where the newest landing of the one before it failed. */
export function ticketLandingOpened(
  joined: TicketLandingsJoined,
  cycle: number,
): string | undefined {
  const before = joined.byCycle.get(cycle - 1)?.at(-1);
  if (before?.state !== "Failed") return undefined;
  return before.failure === undefined
    ? "After failed landing"
    : `After ${before.failure.toLowerCase()}`;
}

/** The landing the status bar names while the ticket is finalizing: the newest, while it is still live. */
export function ticketLandingCurrent(
  landings: readonly TicketLanding[],
): TicketLanding | undefined {
  const newest = landings.at(-1);
  switch (newest?.state) {
    case undefined:
      return undefined;
    case "Running":
    case "Held":
    case "AwaitingApproval":
      return newest;
    case "Failed":
    case "Unavailable":
    case "Landed":
    case "Proposed":
    case "Invalidated":
      return undefined;
  }
}
