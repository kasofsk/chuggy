/**
 * The lead's refusal to dispatch a released ticket: its append-only ledger, the
 * standing derived from it, and the project-authorized reads the API has onto
 * both.
 *
 * IT IS APPEND-ONLY AND "STANDING" IS DERIVED. A lift written as an update of a
 * standing column would not be append-only, and it would lose the thing an
 * owner most wants to see — that the lead refused this ticket twice and lifted
 * it once. So a lift is its own entry, standing is "the latest entry for the
 * ticket is a refusal", and standing rule 3 is why nothing stores it.
 *
 * SUPERSESSION IS NOT STORED EITHER. A refusal cleared by a new authoring
 * version is a comparison between the refusal's `ticketVersion` and the version
 * whoever is reading already holds, so the reader makes it and the ledger keeps
 * saying what the lead did.
 *
 * IT IS NOT A NATIVE ACTION. Nothing here is addressed to a person and nothing
 * here admits an answer: the lead refuses, the record says so, and a ticket
 * leaves the refusal behind by being authored again.
 */

import type { TicketId } from "../domain/ids.ts";
import type { Principal, ProjectAccess } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";
import type { SelectorLiftChoice, SelectorRefusalChoice } from "./selector.ts";

/** What the lead did about one ticket, in the order it did it. */
export const allAgenticRefusalEvents = ["Refused", "Lifted"] as const;
export type AgenticRefusalEvent = (typeof allAgenticRefusalEvents)[number];

/**
 * One entry of one ticket's refusal ledger. A lift carries the version and the
 * reason of the refusal it lifts, so an entry is readable without a join.
 */
export interface AgenticRefusalEntry {
  readonly ordinal: number;
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly event: AgenticRefusalEvent;
  readonly ticketVersion: number;
  readonly reason: string;
  readonly decision: string;
  readonly recordedAt: string;
}

/** A ticket whose latest entry is a refusal, which is what standing means. */
export interface AgenticRefusalRecord {
  readonly ticket: TicketId;
  readonly ticketVersion: number;
  readonly reason: string;
  readonly decision: string;
  readonly recordedAt: string;
}

export interface AgenticRefusalRead {
  /** Every ticket in the project whose latest entry is a refusal. */
  standing(
    partition: Partition,
    limit: number,
  ): Promise<readonly AgenticRefusalRecord[]>;
  /** One ticket's whole ledger, oldest first. */
  ledger(
    partition: Partition,
    ticket: TicketId,
    limit: number,
  ): Promise<readonly AgenticRefusalEntry[]>;
}

export interface AgenticRefusalWrite {
  /** Appends one decision's refusals and lifts as one transaction, idempotent on the decision. */
  record(input: {
    readonly partition: Partition;
    readonly decision: string;
    readonly refusals: readonly SelectorRefusalChoice[];
    readonly lifts: readonly SelectorLiftChoice[];
  }): Promise<"Recorded" | "AlreadyRecorded">;
}

export type AgenticRefusalsResult =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly refusals: readonly AgenticRefusalRecord[];
    };

export type TicketAgenticRefusalsResult =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly ticket: TicketId;
      readonly entries: readonly AgenticRefusalEntry[];
      /** Present exactly where the latest entry is a refusal. */
      readonly standing?: AgenticRefusalRecord;
    };

export interface AgenticRefusalService {
  standing(
    principal: Principal,
    partition: Partition,
    limit: number,
  ): Promise<AgenticRefusalsResult>;
  ledger(
    principal: Principal,
    partition: Partition,
    ticket: TicketId,
    limit: number,
  ): Promise<TicketAgenticRefusalsResult>;
}

/**
 * The refusal a ledger currently stands on, which is its last entry where that
 * entry is a refusal. The entries are read oldest first, so the last is the
 * latest and no ordering is assumed beyond the one the port promises.
 */
export function agenticRefusalStanding(
  entries: readonly AgenticRefusalEntry[],
): AgenticRefusalRecord | undefined {
  const latest = entries[entries.length - 1];
  if (latest === undefined || latest.event !== "Refused") return undefined;
  return {
    ticket: latest.ticket,
    ticketVersion: latest.ticketVersion,
    reason: latest.reason,
    decision: latest.decision,
    recordedAt: latest.recordedAt,
  };
}

/** Whether a refusal has been cleared by the ticket being authored again. */
export function agenticRefusalIsSuperseded(
  refusal: AgenticRefusalRecord,
  ticketVersion: number,
): boolean {
  return refusal.ticketVersion !== ticketVersion;
}

/** Exposes the lead's refusals only through current project read access. */
export function agenticRefusals(
  access: ProjectAccess,
  read: AgenticRefusalRead,
): AgenticRefusalService {
  return {
    standing: async (principal, partition, limit) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : { result: "Found", refusals: await read.standing(partition, limit) },
    ledger: async (principal, partition, ticket, limit) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const entries = await read.ledger(partition, ticket, limit);
      const standing = agenticRefusalStanding(entries);
      return {
        result: "Found",
        ticket,
        entries,
        ...(standing === undefined ? {} : { standing }),
      };
    },
  };
}
