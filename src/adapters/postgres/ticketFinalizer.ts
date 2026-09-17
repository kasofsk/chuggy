import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  decode,
  encode,
  OBLIGATION,
} from "../../interpreter/chuggernaut/codec.js";
import type {
  TicketFinalizerClaim,
  TicketFinalizerStore,
} from "../../interpreter/ticketFinalizer.ts";
import type {
  ChangeProposalMerging,
  ChangeProposalPublication,
  ChangeProposalRequest,
} from "../../interpreter/changeProposal.ts";
import {
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asForgeCredentialReference,
  asProposalDisplayUrl,
  asProposalMarker,
  asProposalNumber,
  asProposalRemoteIdentity,
  changeProposalRequest,
  type ChangeProposalEvidence,
} from "../../interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../interpreter/finalizer.ts";
import { ContentRef } from "../../domain/chuggernaut/task.js";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../interpreter/projectStore.ts";
import { finalizerRowValue } from "./finalizerRows.ts";

interface ClaimRow {
  readonly tenant: string;
  readonly project: string;
  readonly identity: string;
  readonly obligation: string;
  readonly claim_generation: string | null;
  readonly repository: string | null;
  readonly recovery_epoch: string | null;
  readonly base_ref: string | null;
  readonly base_commit: string | null;
  readonly head_ref: string | null;
  readonly candidate: string | null;
  readonly promotion: string;
  readonly request: string | null;
  readonly publication: string | null;
  readonly merging: string | null;
  readonly outcome: string | null;
  readonly evidence_ref: string | null;
}

const promotions = ["Idle", "Unanswered", "Published"] as const;
const outcomes = ["Succeeded", "NeedsWork", "Unavailable"] as const;

function jsonRecord(text: string, what: string): Record<string, unknown> {
  return rowRecord(JSON.parse(text), what);
}

function rowRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`ticket finalizer row: ${what} is not an object`);
  return value as Record<string, unknown>;
}

function rowString(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (typeof value !== "string")
    throw new Error(`ticket finalizer row: ${name} is not text`);
  return value;
}

function rowCounter(row: Record<string, unknown>, name: string): number {
  const value = row[name];
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`ticket finalizer row: ${name} is not a counter`);
  return Number(value);
}

function proposalEvidence(value: unknown): ChangeProposalEvidence {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("ticket finalizer row: proposal evidence is not an object");
  const row = value as Record<string, unknown>;
  const identity = rowRecord(row["identity"], "identity");
  const head = rowRecord(row["head"], "head");
  const base = rowRecord(row["base"], "base");
  const number = identity["number"];
  const mergeability = row["mergeability"];
  const status = finalizerRowValue(
    ["Open", "Closed", "Merged", "Superseded"] as const,
    rowString(row, "status"),
    "proposal status",
  );
  return {
    identity: {
      forge: asForgeBindingId(rowString(identity, "forge")),
      remote: asProposalRemoteIdentity(rowString(identity, "remote")),
      ...(number === undefined
        ? {}
        : { number: asProposalNumber(Number(number)) }),
    },
    repository: asRepositoryId(rowString(row, "repository")),
    marker: asProposalMarker(rowString(row, "marker")),
    head: {
      ref: asGitRefName(rowString(head, "ref")),
      commit: asGitObjectId(rowString(head, "commit")),
    },
    base: {
      ref: asGitRefName(rowString(base, "ref")),
      commit: asGitObjectId(rowString(base, "commit")),
    },
    title: rowString(row, "title"),
    body: rowString(row, "body"),
    status,
    ...(mergeability === undefined
      ? {}
      : {
          mergeability: finalizerRowValue(
            ["Mergeable", "Conflicting", "Blocked", "Unknown"] as const,
            typeof mergeability === "string"
              ? mergeability
              : (() => {
                  throw new Error(
                    "ticket finalizer row: proposal mergeability is not text",
                  );
                })(),
            "proposal mergeability",
          ),
        }),
    ...(typeof row["mergeCommit"] === "string"
      ? { mergeCommit: asGitObjectId(row["mergeCommit"]) }
      : {}),
    ...(typeof row["url"] === "string"
      ? { url: asProposalDisplayUrl(row["url"]) }
      : {}),
  };
}

function proposalRequest(text: string): ChangeProposalRequest {
  const row = jsonRecord(text, "request");
  const binding = rowRecord(row["binding"], "binding");
  const partition = rowRecord(row["partition"], "partition");
  const head = rowRecord(row["head"], "head");
  const base = rowRecord(row["base"], "base");
  const request = changeProposalRequest({
    binding: {
      forge: asForgeBindingId(rowString(binding, "forge")),
      credential: asForgeCredentialReference(rowString(binding, "credential")),
    },
    partition: {
      tenant: asTenantId(rowString(partition, "tenant")),
      project: asProjectId(rowString(partition, "project")),
    },
    repository: asRepositoryId(rowString(row, "repository")),
    request: asChangeProposalRequestIdentity(rowString(row, "request")),
    headRef: asGitRefName(rowString(head, "ref")),
    headCommit: asGitObjectId(rowString(head, "commit")),
    baseRef: asGitRefName(rowString(base, "ref")),
    baseCommit: asGitObjectId(rowString(base, "commit")),
    title: rowString(row, "title"),
    body: rowString(row, "body"),
  });
  if (request.marker !== row["marker"])
    throw new Error("ticket finalizer row: request marker is not canonical");
  return request;
}

function publicationOf(text: string): ChangeProposalPublication {
  const row = jsonRecord(text, "publication");
  switch (row["publication"]) {
    case "Unopened":
      return { publication: "Unopened" };
    case "Idle":
      return { publication: "Idle", creations: rowCounter(row, "creations") };
    case "Unanswered": {
      const reading = row["reading"];
      return {
        publication: "Unanswered",
        creations: rowCounter(row, "creations"),
        reconciliations: rowCounter(row, "reconciliations"),
        ...(reading === undefined ? {} : { reading: proposalReading(reading) }),
      };
    }
    case "Answered":
      return {
        publication: "Answered",
        creation: proposalCreation(row["creation"]),
      };
    default:
      throw new Error("ticket finalizer row: unknown publication state");
  }
}

function proposalCreation(
  value: unknown,
): Extract<ChangeProposalPublication, { publication: "Answered" }>["creation"] {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("ticket finalizer row: creation is not an object");
  const row = value as Record<string, unknown>;
  const created = finalizerRowValue(
    ["Created", "AlreadyExists", "Contradictory", "Unstorable"] as const,
    rowString(row, "created"),
    "proposal creation",
  );
  if (created === "Unstorable") return { created };
  const evidence = proposalEvidence(row["evidence"]);
  return created === "Contradictory"
    ? {
        created,
        contradiction: proposalContradiction(row),
        evidence,
      }
    : { created, evidence };
}

function proposalContradiction(row: Record<string, unknown>) {
  return finalizerRowValue(
    [
      "Closed",
      "Merged",
      "Superseded",
      "ForgeMismatch",
      "RepositoryMismatch",
      "HeadMismatch",
      "BaseMismatch",
      "MetadataMismatch",
      "MarkerMismatch",
    ] as const,
    rowString(row, "contradiction"),
    "proposal contradiction",
  );
}

function proposalReading(
  value: unknown,
): Extract<
  ChangeProposalPublication,
  { publication: "Unanswered" }
>["reading"] {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("ticket finalizer row: reading is not an object");
  const row = value as Record<string, unknown>;
  const reconciled = finalizerRowValue(
    ["Accepted", "Absent", "Contradictory", "Unstorable"] as const,
    rowString(row, "reconciled"),
    "proposal reconciliation",
  );
  if (reconciled === "Absent" || reconciled === "Unstorable")
    return { reconciled };
  const evidence = proposalEvidence(row["evidence"]);
  return reconciled === "Contradictory"
    ? {
        reconciled,
        contradiction: proposalContradiction(row),
        evidence,
      }
    : { reconciled, evidence };
}

function mergingOf(text: string): ChangeProposalMerging {
  const row = jsonRecord(text, "merging");
  switch (row["merging"]) {
    case "Unasked":
      return { merging: "Unasked" };
    case "Idle":
      return { merging: "Idle", merges: rowCounter(row, "merges") };
    case "Unanswered": {
      const reading = row["reading"];
      return {
        merging: "Unanswered",
        merges: rowCounter(row, "merges"),
        readings: rowCounter(row, "readings"),
        ...(reading === undefined ? {} : { reading: mergeReading(reading) }),
      };
    }
    case "Answered":
      return { merging: "Answered", merge: mergeAnswer(row["merge"]) };
    default:
      throw new Error("ticket finalizer row: unknown merging state");
  }
}

function mergeAnswer(
  value: unknown,
): Extract<ChangeProposalMerging, { merging: "Answered" }>["merge"] {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("ticket finalizer row: merge is not an object");
  const row = value as Record<string, unknown>;
  const merged = finalizerRowValue(
    ["Merged", "HeadMoved", "NotMergeable"] as const,
    rowString(row, "merged"),
    "proposal merge",
  );
  if (merged === "Merged")
    return {
      merged,
      mergeCommit: asGitObjectId(rowString(row, "mergeCommit")),
    };
  if (merged === "HeadMoved") return { merged };
  return {
    merged,
    reason: finalizerRowValue(
      ["Conflict", "Blocked"] as const,
      rowString(row, "reason"),
      "proposal merge reason",
    ),
  };
}

function mergeReading(
  value: unknown,
): Extract<ChangeProposalMerging, { merging: "Unanswered" }>["reading"] {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("ticket finalizer row: merge reading is not an object");
  const row = value as Record<string, unknown>;
  const reconciled = finalizerRowValue(
    ["Accepted", "Unmerged", "Contradictory", "Absent", "Unstorable"] as const,
    rowString(row, "reconciled"),
    "proposal merge reconciliation",
  );
  if (reconciled === "Absent" || reconciled === "Unstorable")
    return { reconciled };
  const evidence = proposalEvidence(row["evidence"]);
  return reconciled === "Contradictory"
    ? {
        reconciled,
        contradiction: proposalContradiction(row),
        evidence,
      }
    : { reconciled, evidence };
}

function claimed(row: ClaimRow): TicketFinalizerClaim {
  if (
    row.claim_generation === null ||
    row.publication === null ||
    row.merging === null
  )
    throw new Error("ticket finalizer claim returned an incomplete row");
  const obligation = decode(row.obligation, OBLIGATION);
  if (obligation.kind !== "FinalizeTicket")
    throw new Error("finalizer row holds another obligation");
  const partition = {
    tenant: asTenantId(row.tenant),
    project: asProjectId(row.project),
  };
  const prepared =
    row.repository === null ||
    row.recovery_epoch === null ||
    row.base_ref === null ||
    row.base_commit === null ||
    row.head_ref === null ||
    row.candidate === null
      ? undefined
      : {
          repository: {
            partition,
            repository: asRepositoryId(row.repository),
            recoveryEpoch: asRecoveryEpoch(row.recovery_epoch),
          },
          base: {
            ref: asGitRefName(row.base_ref),
            commit: asGitObjectId(row.base_commit),
          },
          headRef: asGitRefName(row.head_ref),
          candidate: asGitObjectId(row.candidate),
        };
  return {
    partition,
    identity: row.identity,
    generation: Number(row.claim_generation),
    obligation,
    ...prepared,
    ...(row.request === null ? {} : { request: proposalRequest(row.request) }),
    promotion: finalizerRowValue(promotions, row.promotion, "promotion state"),
    publication: publicationOf(row.publication),
    merging: mergingOf(row.merging),
    ...(row.outcome === null || row.evidence_ref === null
      ? {}
      : {
          completion: {
            outcome: finalizerRowValue(outcomes, row.outcome, "outcome"),
            evidence: ContentRef(Number(row.evidence_ref)),
          },
        }),
  };
}

const wrote = (result: pg.QueryResult): boolean => result.rowCount === 1;

async function ticketFinalizerRegister(
  pool: pg.Pool,
  partition: { readonly tenant: string; readonly project: string },
  identity: string,
  obligation: Parameters<typeof encode>[0],
): Promise<boolean> {
  const serialized = encode(obligation);
  const inserted =
    await pool.query(sql`INSERT INTO ticket_machine_finalization(tenant,project,identity,obligation)
    VALUES(${partition.tenant},${partition.project},${identity},${serialized}) ON CONFLICT DO NOTHING`);
  if (inserted.rowCount === 1) return true;
  const found = await pool.query<{
    obligation: string;
  }>(sql`SELECT obligation FROM ticket_machine_finalization
    WHERE tenant=${partition.tenant} AND project=${partition.project} AND identity=${identity}`);
  return found.rows[0]?.obligation === serialized;
}

export function postgresTicketFinalizer(pool: pg.Pool): TicketFinalizerStore {
  return {
    register: (partition, identity, obligation) =>
      ticketFinalizerRegister(pool, partition, identity, obligation),
    claim: async (owner, leaseMs, recoveryEpoch) => {
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1)
        throw new RangeError("finalizer lease must be positive");
      const found =
        await pool.query<ClaimRow>(sql`WITH picked AS (SELECT f.tenant,f.project,f.identity,(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) AS recovery_epoch FROM ticket_machine_finalization f JOIN project p ON p.tenant=f.tenant AND p.project=f.project
          WHERE f.state='Pending' AND p.lifecycle='Active' AND (SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)=${recoveryEpoch} AND (f.claim_until IS NULL OR f.claim_until<=clock_timestamp())
          ORDER BY f.created_at,f.tenant,f.project,f.identity FOR UPDATE OF f SKIP LOCKED LIMIT 1)
          UPDATE ticket_machine_finalization f SET claim_owner=${owner},claim_until=clock_timestamp()+(${leaseMs}::bigint*interval '1 millisecond'),claim_recovery_epoch=p.recovery_epoch,claim_generation=f.claim_generation+1
          FROM picked p WHERE (f.tenant,f.project,f.identity)=(p.tenant,p.project,p.identity)
          RETURNING f.tenant,f.project,f.identity,f.obligation,
            f.claim_generation::text AS claim_generation,f.repository,f.recovery_epoch,
            f.base_ref,f.base_commit,f.head_ref,f.candidate,f.promotion,
            f.request::text AS request,f.publication::text AS publication,
            f.merging::text AS merging,f.outcome,f.evidence_ref::text AS evidence_ref`);
      return found.rows[0] === undefined ? undefined : claimed(found.rows[0]);
    },
    prepare: async (claim, repository, base, candidate, headRef) =>
      wrote(
        await pool.query(
          sql`UPDATE ticket_machine_finalization SET repository=${repository.repository},recovery_epoch=${repository.recoveryEpoch},base_ref=${base.ref},base_commit=${base.commit},head_ref=${headRef},candidate=${candidate},updated_at=clock_timestamp() WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project} AND identity=${claim.identity} AND claim_generation=${claim.generation} AND claim_until>clock_timestamp() AND state='Pending'`,
        ),
      ),
    promotion: async (claim, state) =>
      wrote(
        await pool.query(
          sql`UPDATE ticket_machine_finalization SET promotion=${state},updated_at=clock_timestamp() WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project} AND identity=${claim.identity} AND claim_generation=${claim.generation} AND claim_until>clock_timestamp() AND state='Pending'`,
        ),
      ),
    initialize: async (claim, request) =>
      wrote(
        await pool.query(
          sql`UPDATE ticket_machine_finalization SET request=${JSON.stringify(request)}::jsonb,updated_at=clock_timestamp() WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project} AND identity=${claim.identity} AND claim_generation=${claim.generation} AND claim_until>clock_timestamp() AND state='Pending'`,
        ),
      ),
    publication: async (claim, publication) =>
      wrote(
        await pool.query(
          sql`UPDATE ticket_machine_finalization SET publication=${JSON.stringify(publication)}::jsonb,updated_at=clock_timestamp() WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project} AND identity=${claim.identity} AND claim_generation=${claim.generation} AND claim_until>clock_timestamp() AND state='Pending'`,
        ),
      ),
    merging: async (claim, merging) =>
      wrote(
        await pool.query(
          sql`UPDATE ticket_machine_finalization SET merging=${JSON.stringify(merging)}::jsonb,updated_at=clock_timestamp() WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project} AND identity=${claim.identity} AND claim_generation=${claim.generation} AND claim_until>clock_timestamp() AND state='Pending'`,
        ),
      ),
    complete: async (claim, outcome, evidence) =>
      wrote(
        await pool.query(
          sql`UPDATE ticket_machine_finalization SET outcome=${outcome},evidence_ref=${evidence},updated_at=clock_timestamp() WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project} AND identity=${claim.identity} AND claim_generation=${claim.generation} AND claim_until>clock_timestamp() AND state='Pending'`,
        ),
      ),
    reported: async (claim) =>
      wrote(
        await pool.query(
          sql`UPDATE ticket_machine_finalization SET state='Completed',updated_at=clock_timestamp() WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project} AND identity=${claim.identity} AND claim_generation=${claim.generation} AND claim_until>clock_timestamp() AND state='Pending'`,
        ),
      ),
    release: async (claim) => {
      await pool.query(
        sql`UPDATE ticket_machine_finalization SET claim_owner=NULL,claim_until=NULL WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project} AND identity=${claim.identity} AND claim_generation=${claim.generation}`,
      );
    },
  };
}
