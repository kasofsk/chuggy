/**
 * An epic groups tickets under a title and a description. It is documentation
 * only: it never changes a ticket's readiness, dependencies, evaluation or
 * finalization, so nothing here reads or writes the ticket machine.
 *
 * `decideEpic` is the rule for a save, and `epicDraftDeleted` for the one
 * other write: a deleted draft leaves every epic holding it, Archived ones
 * included, since no save could keep a member that is no longer a ticket.
 * Progress and status are derived from the members' phases at the moment they
 * are asked and stored nowhere.
 */

import { phaseTags, type Phase } from "./phase.ts";

/** The longest title, in code points. */
export const epicTitleCharsMax = 200;

/** The longest summary, in code points. */
export const epicSummaryCharsMax = 600;

/** The most bytes of UTF-8 an epic's canonical JSON content may weigh. */
export const epicContentBytesMax = 65_536;

/** The most members an epic holds. */
export const epicTicketsMax = 100;

export const epicVisibilities = ["Active", "Archived"] as const;
export type EpicVisibility = (typeof epicVisibilities)[number];

export interface EpicContent {
  readonly title: string;
  /** Absent rather than blank. */
  readonly summary?: string;
  readonly description: string;
  readonly visibility: EpicVisibility;
  /** Ascending and free of duplicates. */
  readonly tickets: readonly number[];
}

export interface Epic {
  readonly revision: number;
  readonly content: EpicContent;
}

/** The epics held, by number. */
export type EpicState = ReadonlyMap<number, Epic>;

export type EpicCommand =
  | { readonly kind: "Create"; readonly content: EpicContent }
  | {
      readonly kind: "Revise";
      readonly epic: number;
      readonly expected: number;
      readonly content: EpicContent;
    };

export type EpicRefusal =
  | {
      readonly kind: "Refused";
      readonly reason:
        | "MissingEpic"
        | "ArchivedEpic"
        | "EmptyTitle"
        | "LongTitle"
        | "LongSummary"
        | "ManyTickets"
        | "LargeContent";
    }
  | {
      readonly kind: "Refused";
      readonly reason: "StaleRevision";
      readonly current: number;
    }
  | {
      readonly kind: "Refused";
      readonly reason: "UnknownTickets";
      readonly tickets: readonly number[];
    };

export type EpicOutcome =
  | {
      readonly kind: "Saved";
      readonly epic: number;
      readonly revision: number;
    }
  | EpicRefusal;

function epicCodePointsCount(text: string): number {
  return [...text].length;
}

/** Keys in code-point order, which is the canonical form of this shape. */
function epicCanonicalJson(content: EpicContent): string {
  return JSON.stringify({
    description: content.description,
    ...(content.summary === undefined ? {} : { summary: content.summary }),
    tickets: content.tickets,
    title: content.title,
    visibility: content.visibility,
  });
}

function epicCanonicalBytes(content: EpicContent): number {
  return new TextEncoder().encode(epicCanonicalJson(content)).length;
}

function epicContentRefusal(
  content: EpicContent,
  isTicket: (ticket: number) => boolean,
): EpicRefusal | null {
  if (content.title.trim() === "") {
    return { kind: "Refused", reason: "EmptyTitle" };
  }
  if (epicCodePointsCount(content.title) > epicTitleCharsMax) {
    return { kind: "Refused", reason: "LongTitle" };
  }
  if (epicCodePointsCount(content.summary ?? "") > epicSummaryCharsMax) {
    return { kind: "Refused", reason: "LongSummary" };
  }
  if (content.tickets.length > epicTicketsMax) {
    return { kind: "Refused", reason: "ManyTickets" };
  }
  if (epicCanonicalBytes(content) > epicContentBytesMax) {
    return { kind: "Refused", reason: "LargeContent" };
  }
  const unknown = content.tickets.filter((ticket) => !isTicket(ticket));
  return unknown.length === 0
    ? null
    : { kind: "Refused", reason: "UnknownTickets", tickets: unknown };
}

/** An Archived epic that stays Archived keeps its members. */
function epicArchivedMembersChange(
  held: EpicContent,
  offered: EpicContent,
): boolean {
  return (
    held.visibility === "Archived" &&
    offered.visibility === "Archived" &&
    (held.tickets.length !== offered.tickets.length ||
      held.tickets.some((ticket, index) => ticket !== offered.tickets[index]))
  );
}

function decideEpicAsserted(state: EpicState, content: EpicContent): void {
  content.tickets.forEach((ticket, index) => {
    if (!Number.isSafeInteger(ticket) || ticket < 1)
      throw new Error(`decideEpic: ${String(ticket)} is not a ticket number`);
    const before = content.tickets[index - 1];
    if (before !== undefined && before >= ticket)
      throw new Error("decideEpic: tickets are not ascending and distinct");
  });
  if (content.summary !== undefined && content.summary.trim() === "")
    throw new Error("decideEpic: a blank summary is held as none");
  for (let number = 1; number <= state.size; number += 1)
    if (!state.has(number))
      throw new Error(`decideEpic: epic ${String(number)} is missing`);
}

/**
 * Decides one write against the epics held. `isTicket` answers whether the
 * project held that ticket or holds it as a draft, gathered before the call.
 */
export function decideEpic(
  state: EpicState,
  command: EpicCommand,
  isTicket: (ticket: number) => boolean,
): EpicOutcome {
  decideEpicAsserted(state, command.content);
  if (command.kind === "Create") {
    return (
      epicContentRefusal(command.content, isTicket) ?? {
        kind: "Saved",
        epic: state.size + 1,
        revision: 1,
      }
    );
  }
  const held = state.get(command.epic);
  if (held === undefined) {
    return { kind: "Refused", reason: "MissingEpic" };
  }
  if (command.expected !== held.revision) {
    return { kind: "Refused", reason: "StaleRevision", current: held.revision };
  }
  if (epicArchivedMembersChange(held.content, command.content)) {
    return { kind: "Refused", reason: "ArchivedEpic" };
  }
  return (
    epicContentRefusal(command.content, isTicket) ?? {
      kind: "Saved",
      epic: command.epic,
      revision: held.revision + 1,
    }
  );
}

/** The state after an outcome: unchanged unless it saved. */
export function applyEpic(
  state: EpicState,
  command: EpicCommand,
  outcome: EpicOutcome,
): EpicState {
  if (outcome.kind !== "Saved") {
    return state;
  }
  return new Map(state).set(outcome.epic, {
    revision: outcome.revision,
    content: command.content,
  });
}

/**
 * The epics after `draft` is deleted: each holding it drops it and takes the
 * next revision, whatever its visibility; the rest are unchanged.
 */
export function epicDraftDeleted(state: EpicState, draft: number): EpicState {
  if (!Number.isSafeInteger(draft) || draft < 1)
    throw new Error(
      `epicDraftDeleted: ${String(draft)} is not a ticket number`,
    );
  const next = new Map(state);
  for (const [number, epic] of state) {
    if (!epic.content.tickets.includes(draft)) continue;
    next.set(number, {
      revision: epic.revision + 1,
      content: {
        ...epic.content,
        tickets: epic.content.tickets.filter((ticket) => ticket !== draft),
      },
    });
  }
  return next;
}

export type EpicPhaseCounts = Readonly<Record<Phase, number>>;

/** Where a member stands: its ticket's phase, or a draft not yet released. */
export type EpicMemberState = Phase | "Draft";

export interface EpicProgress {
  readonly byPhase: EpicPhaseCounts;
  readonly drafts: number;
  readonly done: number;
  /** Every member but the Revoked. */
  readonly total: number;
}

export const epicStatuses = [
  "empty",
  "done",
  "attention",
  "not_started",
  "in_progress",
] as const;
export type EpicStatus = (typeof epicStatuses)[number];

/** The members counted by phase and drafts apart, Revoked left out of the total. */
export function epicProgress(
  members: readonly EpicMemberState[],
): EpicProgress {
  const counts = Object.fromEntries(phaseTags.map((phase) => [phase, 0])) as {
    -readonly [P in Phase]: number;
  };
  let drafts = 0;
  for (const member of members) {
    if (member === "Draft") drafts += 1;
    else counts[member] += 1;
  }
  return {
    byPhase: counts,
    drafts,
    done: counts.Done,
    total: members.length - counts.Revoked,
  };
}

/**
 * The first that holds: empty, done (every member Done or Revoked),
 * attention (a member is Escalated), not_started (every member not Revoked is
 * Pending or a draft), in_progress. A ticket never returns to Pending once it
 * has run, so Pending alone says no work has started.
 */
export function epicStatus(progress: EpicProgress): EpicStatus {
  const { byPhase, drafts, done, total } = progress;
  if (total === 0) {
    return "empty";
  }
  if (done === total) {
    return "done";
  }
  if (byPhase.Escalated > 0) {
    return "attention";
  }
  if (byPhase.Pending + drafts === total) {
    return "not_started";
  }
  return "in_progress";
}
