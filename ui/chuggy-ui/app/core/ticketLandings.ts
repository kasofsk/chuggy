/**
 * What a ticket's page draws of its landings: one row a landing under the
 * cycle it belongs to, and a fragment on that cycle's header.
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

import type {
  TicketEscalation,
  TicketLandingsResponse,
} from "../../../../src/contract/responses.ts";
import type {
  FinalizationUnavailableKind,
  TicketLandingState,
} from "../../../../src/contract/rosters.ts";
import {
  changeProposalCreationLabel,
  changeProposalMergeabilityLabel,
  changeProposalMergeLabel,
  changeProposalMergeReasonLabel,
  changeProposalMergeWaitLabel,
  changeProposalStatusLabel,
  finalizationFailureKindLabel,
  finalizationUnavailableKindLabel,
  ticketLandingStateLabel,
} from "./codeLabels.ts";
import type { Copy, CopyText } from "./copy.ts";
import { agoText } from "./figures.ts";
import type { PanelState } from "./freshness.ts";
import { httpsUrl } from "./httpsUrl.ts";
import { commitLabel } from "./labels.ts";
import type { Label } from "./labels.ts";
import { runCountLabel } from "./runTotals.ts";
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

/**
 * The head the forge merged and the one this landing evaluated, named both
 * only where they differ.
 */
export interface TicketLandingHeads {
  readonly merged: Label;
  readonly evaluated: Label;
}

/** The pull request a landing opened, as its detail draws it. */
export interface TicketLandingProposal {
  readonly head: string;
  readonly base: string;
  readonly creation: string | undefined;
  readonly status: string | undefined;
  readonly merge: string | undefined;
  readonly mergeReason: string | undefined;
  readonly mergeability: string | undefined;
  /** The forge's own word for where the merge stands, as it said it. */
  readonly mergeState: string | undefined;
  readonly mergeCommit: Label | undefined;
  readonly heads: TicketLandingHeads | undefined;
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
  /** When the forge was last asked about a merge that waits on it. */
  readonly checkedAt: string | undefined;
}

/**
 * The hold a landing waits on or escalated from, and since when, with the
 * forge's reason and who removed its pull request where it escalates a removal
 * from a merge queue.
 */
export interface TicketLandingHold {
  readonly kind: FinalizationUnavailableKind;
  readonly label: string;
  readonly since: string;
  readonly removal: string | undefined;
}

/**
 * What a landing's merge waits on at the forge, what the forge said, and when
 * it was asked.
 */
export interface TicketLandingWait {
  readonly label: string;
  readonly mergeState: string | undefined;
  readonly checkedAt: string;
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
  readonly wait: TicketLandingWait | undefined;
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
  const parsed = httpsUrl(url);
  return parsed === undefined
    ? undefined
    : { href: parsed.href, host: parsed.host };
}

/**
 * The two heads a pull request names, where the forge merged one other than
 * the one it was opened at.
 */
function ticketLandingHeads(
  proposal: TicketLandingRead["proposal"],
): TicketLandingHeads | undefined {
  return proposal?.mergedHead === undefined
    ? undefined
    : {
        merged: commitLabel(proposal.mergedHead),
        evaluated: commitLabel(proposal.headCommit),
      };
}

/**
 * A landing's pull request as its detail draws it: its merge commit is the one
 * the landing landed at wherever the finalizer did not make the merge itself,
 * and the forge's word on it is drawn only while nothing has settled the
 * landing, after which no reading keeps that word current.
 */
function ticketLandingProposal(
  read: TicketLandingRead,
  text: CopyText,
): TicketLandingProposal | undefined {
  const proposal = read.proposal;
  if (proposal === undefined) return undefined;
  const mergeCommit =
    proposal.mergeCommit ??
    (read.state === "Landed" ? read.landedCommit : undefined);
  return {
    head: proposal.headRef,
    base: proposal.baseRef,
    creation:
      proposal.creation === undefined
        ? undefined
        : text(changeProposalCreationLabel(proposal.creation)),
    status:
      proposal.status === undefined || !ticketLandingLive(read.state)
        ? undefined
        : text(changeProposalStatusLabel(proposal.status)),
    merge:
      proposal.merge === undefined
        ? undefined
        : text(changeProposalMergeLabel(proposal.merge)),
    mergeReason:
      proposal.mergeReason === undefined
        ? undefined
        : text(changeProposalMergeReasonLabel(proposal.mergeReason)),
    mergeability:
      proposal.mergeability === undefined
        ? undefined
        : text(changeProposalMergeabilityLabel(proposal.mergeability)),
    mergeState: proposal.mergeState,
    mergeCommit:
      mergeCommit === undefined ? undefined : commitLabel(mergeCommit),
    heads: ticketLandingHeads(proposal),
  };
}

type TicketLandingHoldRead = NonNullable<
  Extract<TicketLandingRead, { state: "Held" | "Unavailable" }>["hold"]
>;

/** The forge's reason for a removal from a merge queue, and who removed the pull request where it names them. */
function ticketLandingRemovalText(
  removal: NonNullable<TicketLandingHoldRead["removal"]>,
): string {
  return removal.actor === undefined
    ? removal.reason
    : `${removal.reason} by ${removal.actor}`;
}

/**
 * The hold a landing is held at or escalated from: labelled as its kind, a
 * pull request the forge last read as closed being called that, and one a
 * merge queue removed naming the forge's reason and who removed it.
 */
function ticketLandingHoldOf(
  read: TicketLandingRead,
  text: CopyText,
): TicketLandingHold | undefined {
  const hold =
    read.state === "Held" || read.state === "Unavailable"
      ? read.hold
      : undefined;
  if (hold === undefined) return undefined;
  const removal =
    hold.removal === undefined
      ? undefined
      : ticketLandingRemovalText(hold.removal);
  const label = text(
    hold.kind === "ProposalAbsent" && read.proposal?.status === "Closed"
      ? changeProposalStatusLabel(read.proposal.status)
      : finalizationUnavailableKindLabel(hold.kind),
  );
  return {
    kind: hold.kind,
    label: removal === undefined ? label : `${label}: ${removal}`,
    since: hold.since,
    removal,
  };
}

function ticketLandingDetail(
  read: TicketLandingRead,
  text: CopyText,
): TicketLandingDetail {
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
    proposal: ticketLandingProposal(read, text),
    checkedAt: read.state === "AwaitingMerge" ? read.wait.checkedAt : undefined,
  };
}

/** One landing of the read, as the page draws it, in the words `text` gives
 * its codes. */
export function ticketLandingOf(
  read: TicketLandingRead,
  text: CopyText,
): TicketLanding {
  const failureKind = read.attempt?.failureKind;
  return {
    key: `${String(read.cycle)}/${String(read.generation)}`,
    cycle: read.cycle,
    state: read.state,
    word: text(ticketLandingStateLabel(read.state)),
    tone: ticketLandingTone(read.state),
    failure:
      failureKind === undefined
        ? undefined
        : text(finalizationFailureKindLabel(failureKind)),
    conflictCount: read.conflict?.paths.length ?? 0,
    hold: ticketLandingHoldOf(read, text),
    wait:
      read.state === "AwaitingMerge"
        ? {
            label: text(changeProposalMergeWaitLabel(read.wait.reason)),
            mergeState: read.proposal?.mergeState,
            checkedAt: read.wait.checkedAt,
          }
        : undefined,
    link: ticketLandingLink(read.proposal?.url),
    landedCommit:
      read.state === "Landed" ? commitLabel(read.landedCommit) : undefined,
    detail: ticketLandingDetail(read, text),
  };
}

/** The read's state with its answer turned into the landings the page draws. */
export function ticketLandingsRead(
  state: PanelState<TicketLandingsResponse>,
  text: CopyText,
): TicketLandingsState {
  return state.state === "Ready"
    ? {
        ...state,
        value: state.value.landings.map((read) => ticketLandingOf(read, text)),
      }
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

/**
 * What a landing's merge waits on, the forge's own word where it adds to it,
 * and how long ago the forge was asked.
 */
function ticketLandingWaitText(wait: TicketLandingWait, nowMs: number): string {
  const checkedMs = Date.parse(wait.checkedAt);
  return [
    wait.label,
    ...(wait.mergeState === undefined ||
    wait.mergeState.toLowerCase() === wait.label.toLowerCase()
      ? []
      : [wait.mergeState]),
    ...(Number.isFinite(checkedMs)
      ? [`checked ${agoText(nowMs, checkedMs)} ago`]
      : []),
  ].join(" · ");
}

/** The commit a fragment names, under a noun where the row qualifies it. */
export interface TicketLandingCommit {
  readonly name: string | undefined;
  readonly label: Label;
}

/**
 * What a landing's row says beside its pill: text, a link, the commit it
 * landed at, and what a reader must not miss about that commit.
 */
export interface TicketLandingFragment {
  readonly text: string | undefined;
  readonly link: TicketDeliveryLink | undefined;
  readonly commit: TicketLandingCommit | undefined;
  readonly caveat: string | undefined;
}

/**
 * The commit a row says its landing landed at, and, where the forge merged a
 * head other than the one evaluated, that it says so, since the commit alone
 * reads as the evaluated work landing.
 */
function ticketLandingLandedAt(
  landing: TicketLanding,
): Pick<TicketLandingFragment, "commit" | "caveat"> {
  if (landing.landedCommit === undefined)
    return { commit: undefined, caveat: undefined };
  return landing.detail.proposal?.heads === undefined
    ? {
        commit: { name: undefined, label: landing.landedCommit },
        caveat: undefined,
      }
    : {
        commit: { name: "Merged", label: landing.landedCommit },
        caveat: "Unevaluated head",
      };
}

/** The one short fragment a landing's row carries. */
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
                  ? [
                      `${runCountLabel(landing.conflictCount)} file${landing.conflictCount === 1 ? "" : "s"}`,
                    ]
                  : []),
              ].join(" · "),
        link: undefined,
        commit: undefined,
        caveat: undefined,
      };
    case "Held":
      return {
        text:
          landing.hold === undefined
            ? undefined
            : ticketLandingHeldFor(landing.hold, nowMs),
        link: landing.link,
        commit: undefined,
        caveat: undefined,
      };
    case "AwaitingMerge":
      return {
        text:
          landing.wait === undefined
            ? undefined
            : ticketLandingWaitText(landing.wait, nowMs),
        link: landing.link,
        commit: undefined,
        caveat: undefined,
      };
    case "Running":
    case "AwaitingApproval":
    case "Proposed":
    case "Landed":
      return {
        text: undefined,
        link: landing.link,
        ...ticketLandingLandedAt(landing),
      };
    case "Unavailable":
      return {
        text: landing.hold?.label,
        link: undefined,
        commit: undefined,
        caveat: undefined,
      };
    case "Invalidated":
      return {
        text: undefined,
        link: undefined,
        commit: undefined,
        caveat: undefined,
      };
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

/**
 * Who removed the pull request from its base's merge queue and why, for an
 * escalation at the hold the newest landing escalated from where that hold
 * names a removal.
 */
export function ticketLandingEscalatedRemoval(
  landings: readonly TicketLanding[],
  evidence: TicketEscalation["evidence"],
): Copy | undefined {
  const newest = landings.at(-1);
  const hold = newest?.state === "Unavailable" ? newest.hold : undefined;
  return hold?.removal === undefined || hold.kind !== evidence
    ? undefined
    : { id: "ticket-landing-queue-removal", args: { removal: hold.removal } };
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

/** Whether a landing in `state` is still live: running, held or waiting. */
function ticketLandingLive(state: TicketLandingState): boolean {
  switch (state) {
    case "Running":
    case "Held":
    case "AwaitingApproval":
    case "AwaitingMerge":
      return true;
    case "Failed":
    case "Unavailable":
    case "Landed":
    case "Proposed":
    case "Invalidated":
      return false;
  }
}

/** A pull request as a short label: `PR #<n>` where a forge's `…/pull/<n>`
 * address names its number, and its host otherwise. */
export function ticketLandingPullLabel(link: TicketDeliveryLink): string {
  const numbered = /\/pull\/(\d+)\/?$/u.exec(new URL(link.href).pathname);
  return numbered === null ? link.host : `PR #${numbered[1] ?? ""}`;
}

/** A pull request's address as a forge names it, `owner/repository#number`,
 * and its host where the address has no such shape. */
export function ticketLandingLinkLabel(link: TicketDeliveryLink): string {
  const named = /^\/([^/]+)\/([^/]+)\/pulls?\/([0-9]+)/u.exec(
    new URL(link.href).pathname,
  );
  return named === null
    ? link.host
    : `${named[1] ?? ""}/${named[2] ?? ""}#${named[3] ?? ""}`;
}
