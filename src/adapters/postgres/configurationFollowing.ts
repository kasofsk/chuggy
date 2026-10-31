/**
 * The importer's two doors for following a repository head: the candidates it
 * reads, and the move of one ticket, each a function 102 granted to it alone.
 * What the doors answer is decoded here and decided on nowhere else.
 */

import { sql } from "@ts-safeql/sql-tag";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import { asTicketId } from "../../domain/ids.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  parseDraftAuthoring,
  type CanonicalConfiguration,
  type ConfigurationRevisionId,
} from "../../interpreter/authoring.ts";
import {
  configurationFollowingMoveRefusals,
  type ConfigurationFollowingCandidate,
  type ConfigurationFollowingMoved,
  type ConfigurationFollowingPort,
} from "../../interpreter/configurationFollowingSweep.ts";
import {
  asOperationId,
  type Authority,
} from "../../interpreter/operationInbox.ts";
import type { TicketServiceConfig } from "../../interpreter/ticketService.ts";
import { projectRowCounter } from "./rows.ts";
import {
  releasedBriefOf,
  storedOverridesOf,
  storedSelectionOf,
} from "./ticketBrief.ts";

interface ConfigurationFollowingCandidateRow {
  readonly ticket: string | null;
  readonly revision: string | null;
  readonly held: string | null;
  readonly held_canonical: string | null;
  readonly head: string | null;
  readonly head_canonical: string | null;
  readonly brief: string | null;
  readonly overrides: string | null;
  readonly selection: string | null;
  readonly authoring: string | null;
}

/** A column every candidate row carries, refusing the null a function's table types every column with. */
function configurationFollowingColumn(
  value: string | null,
  what: string,
): string {
  if (value === null)
    throw new Error(
      `postgres configuration following: a candidate names no ${what}`,
    );
  return value;
}

/** One row as the candidate it is, keeping the canonical it carries where it is the first naming its revision. */
function configurationFollowingCandidateOf(
  row: ConfigurationFollowingCandidateRow,
  canonicals: Map<ConfigurationRevisionId, CanonicalConfiguration>,
): ConfigurationFollowingCandidate {
  const held = asConfigurationRevisionId(
    configurationFollowingColumn(row.held, "held revision"),
  );
  const head = asConfigurationRevisionId(
    configurationFollowingColumn(row.head, "head revision"),
  );
  if (row.held_canonical !== null)
    canonicals.set(held, asCanonicalConfiguration(row.held_canonical));
  if (row.head_canonical !== null)
    canonicals.set(head, asCanonicalConfiguration(row.head_canonical));
  return {
    ticket: asTicketId(
      projectRowCounter(
        configurationFollowingColumn(row.ticket, "ticket"),
        "ticket",
      ),
    ),
    revision: projectRowCounter(
      configurationFollowingColumn(row.revision, "revision"),
      "ticket revision",
    ),
    held,
    head,
    brief: releasedBriefOf(row.brief),
    overrides: storedOverridesOf(row.overrides),
    selection: storedSelectionOf(row.selection),
    authoring: parseDraftAuthoring(
      configurationFollowingColumn(row.authoring, "authoring"),
    ),
  };
}

/** The door's answer as what became of the move, refusing an answer no roster here holds. */
function configurationFollowingMovedOf(row: {
  readonly result: string | null;
  readonly operation: string | null;
}): ConfigurationFollowingMoved {
  if (row.result === "Accepted") {
    if (row.operation === null)
      throw new Error(
        "postgres configuration following: an accepted move names no operation",
      );
    return { moved: "Accepted", operation: asOperationId(row.operation) };
  }
  const answer = configurationFollowingMoveRefusals.find(
    (refusal) => refusal === row.result,
  );
  if (answer === undefined)
    throw new Error(
      `postgres configuration following: the move door answered ${String(row.result)}`,
    );
  return { moved: "Refused", answer };
}

/** Answers the sweep's port through the importer's own credential, under its authority and the mailbox's bounds. */
export function postgresConfigurationFollowing(
  pool: pg.Pool,
  authority: Authority,
  mailbox: Pick<TicketServiceConfig, "ordinarySoftLimit" | "mailboxHardLimit">,
): ConfigurationFollowingPort {
  return {
    candidates: async ({ binding, after, max }) => {
      const found = await pool.query<ConfigurationFollowingCandidateRow>(
        sql`SELECT ticket::text AS ticket, revision::text AS revision, held,
                   held_canonical, head, head_canonical, brief, overrides,
                   selection, authoring
              FROM configuration_following_candidates(
                ${binding.partition.tenant},${binding.partition.project},
                ${binding.repository},${binding.commit},${authority.subject},
                ${after}::bigint,${max}::integer)`,
      );
      const canonicals = new Map<
        ConfigurationRevisionId,
        CanonicalConfiguration
      >();
      const candidates = found.rows.map((row) =>
        configurationFollowingCandidateOf(row, canonicals),
      );
      return { candidates, canonicals };
    },
    move: async (move) => {
      const moved = await pool.query<{
        result: string | null;
        operation: string | null;
      }>(
        sql`SELECT result, operation FROM follow_configuration_revision(
              ${move.partition.tenant},${move.partition.project},
              ${move.ticket}::bigint,${move.expectedRevision}::bigint,
              ${move.configuration},${JSON.stringify(move.program)},
              ${`follow-${randomUUID()}`},${authority.subject},
              ${mailbox.ordinarySoftLimit}::bigint,
              ${mailbox.mailboxHardLimit}::bigint)`,
      );
      const row = moved.rows[0];
      if (row === undefined || moved.rows.length !== 1)
        throw new Error(
          `postgres configuration following: the move door returned ${String(moved.rows.length)} rows`,
        );
      return configurationFollowingMovedOf(row);
    },
  };
}
