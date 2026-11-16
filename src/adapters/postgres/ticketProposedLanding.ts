/** PostgreSQL read of the pull request a ticket's newest successful landing opened: one call of `read_ticket_proposed_landing`. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { TicketId } from "../../domain/ids.ts";
import {
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asProposalNumber,
  asProposalRemoteIdentity,
} from "../../interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../interpreter/finalizer.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type {
  TicketProposedLanding,
  TicketProposedLandingStore,
} from "../../interpreter/ticketProposalMerge.ts";

interface TicketProposedLandingRow {
  readonly repository: string | null;
  readonly proposal_request: string | null;
  readonly head_ref: string | null;
  readonly head_commit: string | null;
  readonly base_ref: string | null;
  readonly forge: string | null;
  readonly remote: string | null;
  readonly proposal_number: string | null;
  readonly url: string | null;
}

/** The value a column the door always fills holds, failing the read where it holds none. */
function filled(value: string | null, column: string): string {
  if (value === null)
    throw new Error(
      `postgres proposed landing: the door answered no ${column}`,
    );
  return value;
}

function ticketProposedLandingOf(
  row: TicketProposedLandingRow,
): TicketProposedLanding {
  return {
    repository: asRepositoryId(filled(row.repository, "repository")),
    request: asChangeProposalRequestIdentity(
      filled(row.proposal_request, "proposal request"),
    ),
    head: {
      ref: asGitRefName(filled(row.head_ref, "head ref")),
      commit: asGitObjectId(filled(row.head_commit, "head commit")),
    },
    baseRef: asGitRefName(filled(row.base_ref, "base ref")),
    proposal: {
      forge: asForgeBindingId(filled(row.forge, "forge")),
      remote: asProposalRemoteIdentity(filled(row.remote, "remote")),
      number: asProposalNumber(
        Number(filled(row.proposal_number, "proposal number")),
      ),
    },
    ...(row.url === null ? {} : { url: row.url }),
  };
}

async function ticketProposedLandingRead(
  pool: Pick<pg.Pool, "query">,
  partition: Partition,
  ticket: TicketId,
): Promise<TicketProposedLanding | undefined> {
  const found = await pool.query<TicketProposedLandingRow>(
    sql`SELECT repository,proposal_request,head_ref,head_commit,base_ref,
               forge,remote,proposal_number,url
          FROM read_ticket_proposed_landing(${partition.tenant},${partition.project},${ticket}::bigint)`,
  );
  const row = found.rows[0];
  return row === undefined ? undefined : ticketProposedLandingOf(row);
}

export function postgresTicketProposedLandings(
  pool: Pick<pg.Pool, "query">,
): TicketProposedLandingStore {
  return {
    proposed: (partition, ticket) =>
      ticketProposedLandingRead(pool, partition, ticket),
  };
}
