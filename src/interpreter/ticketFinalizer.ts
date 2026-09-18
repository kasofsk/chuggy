import type { FinalizeTicket } from "../domain/chuggernaut/ticket.js";
import type { ContentRef } from "../domain/chuggernaut/task.js";
import { ticketWorkspaceRead } from "./ticketWorkspace.ts";
import { assertNever } from "../domain/assertNever.ts";
import {
  changeProposalRequest,
  proposalMarkerOf,
  reconcileChangeProposal,
  reconcileChangeProposalMerge,
  type ChangeProposalCreationStored,
  type ChangeProposalMergeAnswer,
  type ChangeProposalMergeReconciliationStored,
  type ChangeProposalMerging,
  type ChangeProposalPort,
  type ChangeProposalPublication,
  type ChangeProposalReconciliationStored,
  type ChangeProposalRequest,
  type ChangeProposalRequestIdentity,
} from "./changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  repositoryBindingNarrowed,
  type GitObjectId,
  type GitPromotionPort,
  type ObservedTarget,
  type RepositoryBinding,
  type CommitPermitId,
} from "./finalizer.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";
import type { TicketContentStore } from "./ticketCatalog.ts";
import {
  ticketFinalizationReport,
  type TicketFinalizationOutcome,
} from "./ticketFinalization.ts";
import {
  ticketGitMergeRun,
  type TicketGitMergeConfiguration,
} from "./ticketGitMerge.ts";
import {
  ticketPullRequestNext,
  type TicketPullRequestBounds,
  type TicketPullRequestConfiguration,
} from "./ticketPullRequest.ts";

/** A finalization that lands nothing, and so needs neither a repository nor a forge. */
export interface TicketNoOpConfiguration {
  readonly kind: "finalizer";
  readonly operation: "no-op";
}

export type TicketFinalizerConfiguration =
  | TicketPullRequestConfiguration
  | TicketGitMergeConfiguration
  | TicketNoOpConfiguration;

export interface TicketFinalizerClaim {
  readonly partition: Partition;
  readonly identity: string;
  readonly generation: number;
  readonly obligation: FinalizeTicket;
  readonly request?: ChangeProposalRequest;
  readonly repository?: RepositoryBinding;
  readonly base?: ObservedTarget;
  readonly candidate?: ReturnType<typeof asGitObjectId>;
  readonly headRef?: ReturnType<typeof asGitRefName>;
  readonly promotion: "Idle" | "Unanswered" | "Published";
  readonly completion?: {
    readonly outcome: "Succeeded" | "NeedsWork" | "Unavailable";
    readonly evidence: ContentRef;
  };
  readonly publication: ChangeProposalPublication;
  readonly merging: ChangeProposalMerging;
}

export interface TicketFinalizerStore {
  register(
    partition: Partition,
    identity: string,
    obligation: FinalizeTicket,
  ): Promise<boolean>;
  claim(
    owner: string,
    leaseMs: number,
    recoveryEpoch: RecoveryEpoch,
  ): Promise<TicketFinalizerClaim | undefined>;
  initialize(
    claim: TicketFinalizerClaim,
    request: ChangeProposalRequest,
  ): Promise<boolean>;
  prepare(
    claim: TicketFinalizerClaim,
    repository: RepositoryBinding,
    base: ObservedTarget,
    candidate: ReturnType<typeof asGitObjectId>,
    headRef: ReturnType<typeof asGitRefName>,
  ): Promise<boolean>;
  promotion(
    claim: TicketFinalizerClaim,
    state: "Idle" | "Unanswered" | "Published",
  ): Promise<boolean>;
  publication(
    claim: TicketFinalizerClaim,
    publication: ChangeProposalPublication,
  ): Promise<boolean>;
  merging(
    claim: TicketFinalizerClaim,
    merging: ChangeProposalMerging,
  ): Promise<boolean>;
  complete(
    claim: TicketFinalizerClaim,
    outcome: "Succeeded" | "NeedsWork" | "Unavailable",
    evidence: ContentRef,
  ): Promise<boolean>;
  reported(claim: TicketFinalizerClaim): Promise<boolean>;
  release(claim: TicketFinalizerClaim): Promise<void>;
}

export interface TicketFinalizerInbox {
  submit(
    partition: Partition,
    identity: string,
    command: ReturnType<typeof ticketFinalizationReport>,
  ): Promise<boolean>;
}

export interface TicketFinalizerForges {
  binding(
    repository: string,
  ): { readonly forge: string; readonly credential: string } | undefined;
  proposal(forge: string): ChangeProposalPort | undefined;
}

export interface TicketFinalizerService {
  readonly owner: string;
  readonly leaseMs: number;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly store: TicketFinalizerStore;
  contents(partition: Partition): TicketContentStore;
  readonly bindings: ProjectRepositoryBindingRead;
  readonly git: GitPromotionPort;
  readonly forges: TicketFinalizerForges;
  readonly inbox: TicketFinalizerInbox;
  readonly bounds: TicketPullRequestBounds;
  identities(claim: TicketFinalizerClaim): {
    readonly request: ChangeProposalRequestIdentity;
    readonly permit: CommitPermitId;
  };
}

export interface TicketFinalizerConfig {
  readonly requestClaimLeaseSecs: number;
  readonly requestsPerPassMax: number;
  readonly proposalCreationsMax: number;
  readonly proposalReconciliationsMax: number;
  readonly proposalMergesMax: number;
  readonly proposalMergeReadingsMax: number;
}

export const ticketFinalizerDefaults: TicketFinalizerConfig = {
  requestClaimLeaseSecs: 30,
  requestsPerPassMax: 32,
  proposalCreationsMax: 3,
  proposalReconciliationsMax: 3,
  proposalMergesMax: 3,
  proposalMergeReadingsMax: 3,
};

const finalizerFields: Record<
  TicketFinalizerConfiguration["operation"],
  readonly string[]
> = {
  "pull-request": ["kind", "operation", "target_ref", "branch_prefix", "merge"],
  "git-merge": ["kind", "operation", "target_ref"],
  "no-op": ["kind", "operation"],
};

/** The operation a document asks for, refusing one carrying a field that operation does not honour. */
function parsedOperation(
  row: Record<string, unknown>,
): TicketFinalizerConfiguration["operation"] {
  const operation = row["operation"];
  if (
    operation !== "pull-request" &&
    operation !== "git-merge" &&
    operation !== "no-op"
  )
    throw new TypeError("unsupported finalizer configuration");
  for (const field of Object.keys(row))
    if (!finalizerFields[operation].includes(field))
      throw new TypeError(`finalizer ${operation} does not carry ${field}`);
  return operation;
}

function parsedText(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError("unsupported finalizer configuration");
  return value;
}

function parsedConfiguration(content: string): TicketFinalizerConfiguration {
  const value: unknown = JSON.parse(content);
  if (value === null || typeof value !== "object")
    throw new TypeError("finalizer configuration is not an object");
  const row = value as Record<string, unknown>;
  if (row["kind"] !== "finalizer")
    throw new TypeError("unsupported finalizer configuration");
  const operation = parsedOperation(row);
  if (operation === "no-op") return { kind: "finalizer", operation };
  const target_ref = parsedText(row, "target_ref");
  if (operation === "git-merge")
    return { kind: "finalizer", operation, target_ref };
  const merge = row["merge"];
  if (merge !== undefined && typeof merge !== "boolean")
    throw new TypeError("unsupported finalizer configuration");
  return {
    kind: "finalizer",
    operation,
    target_ref,
    branch_prefix: parsedText(row, "branch_prefix"),
    merge: merge === true,
  };
}

/** The repository binding and the immutable commit the ticket's work published. */
async function ticketFinalizerSource(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim,
): Promise<
  | { readonly binding: RepositoryBinding; readonly commit: GitObjectId }
  | undefined
> {
  const workspace = await ticketWorkspaceRead(
    service.contents(claim.partition),
    claim.obligation.finalization.source,
  );
  const binding = await service.bindings.binding(
    claim.partition,
    asRepositoryId(workspace.repository),
  );
  return binding === undefined
    ? undefined
    : { binding, commit: asGitObjectId(workspace.commit) };
}

/** Publishes the work commit under its own immutable ref, which is what makes it fetchable. */
async function ticketFinalizerPrepared(
  service: TicketFinalizerService,
  binding: RepositoryBinding,
  commit: GitObjectId,
): Promise<boolean> {
  const prepared = await service.git.prepareSource({
    repository: binding,
    ref: asGitRefName(`refs/chuggy/results/${commit}`),
    commit,
    base: commit,
  });
  return prepared.prepared === "Candidate" && prepared.candidate === commit;
}

/** Writes what one operation came to, and records the outcome against that evidence. */
async function ticketFinalizerCompleted(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim,
  outcome: TicketFinalizationOutcome,
  evidence: unknown,
): Promise<boolean> {
  const reference = await service
    .contents(claim.partition)
    .put("application/json", JSON.stringify(evidence));
  return service.store.complete(claim, outcome, reference);
}

async function ticketFinalizerInitialize(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim,
  configuration: TicketPullRequestConfiguration,
): Promise<boolean> {
  const source = await ticketFinalizerSource(service, claim);
  if (
    source === undefined ||
    service.forges.binding(source.binding.repository) === undefined
  )
    return false;
  const base = await service.git.observeTarget(
    repositoryBindingNarrowed(
      source.binding,
      asGitRefName(configuration.target_ref),
    ),
  );
  if (base.observed !== "Target") return false;
  if (!(await ticketFinalizerPrepared(service, source.binding, source.commit)))
    return false;
  return service.store.prepare(
    claim,
    source.binding,
    base.target,
    source.commit,
    asGitRefName(
      `refs/heads/${configuration.branch_prefix}${String(claim.obligation.ticket)}`,
    ),
  );
}

/** Merges the ticket's work into the target ref, which no forge is in the path of. */
async function ticketFinalizerGitMerge(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim,
  configuration: TicketGitMergeConfiguration,
): Promise<boolean> {
  const source = await ticketFinalizerSource(service, claim);
  if (source === undefined) return false;
  if (!(await ticketFinalizerPrepared(service, source.binding, source.commit)))
    return false;
  const settled = await ticketGitMergeRun({
    git: service.git,
    repository: source.binding,
    targetRef: asGitRefName(configuration.target_ref),
    candidate: source.commit,
    permit: service.identities(claim).permit,
  });
  return (
    settled.settled === "Outcome" &&
    ticketFinalizerCompleted(service, claim, settled.outcome, settled.evidence)
  );
}

async function ticketFinalizerPublish(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim,
): Promise<boolean> {
  const { repository, base, candidate, headRef } = claim;
  if (
    repository === undefined ||
    base === undefined ||
    candidate === undefined ||
    headRef === undefined
  )
    return false;
  if (claim.promotion === "Idle") {
    if (!(await service.store.promotion(claim, "Unanswered"))) return false;
    const promoted = await service.git.promoteCandidate({
      repository: repositoryBindingNarrowed(repository, headRef),
      permit: service.identities(claim).permit,
      target: {
        ref: headRef,
        commit: base.commit,
        ...(base.ref === headRef ? {} : { baseRef: base.ref }),
      },
      candidate,
    });
    if (promoted.promoted === "Advanced")
      return service.store.promotion(claim, "Published");
    if (promoted.promoted === "Rejected" && promoted.observed === candidate)
      return service.store.promotion(claim, "Published");
    return false;
  }
  if (claim.promotion === "Unanswered") {
    const proved = await service.git.proveCandidateAncestry({
      repository,
      ref: headRef,
      candidate,
    });
    if (proved.proved === "Ancestor")
      return service.store.promotion(claim, "Published");
    if (proved.proved === "NotAncestor")
      return service.store.promotion(claim, "Idle");
    return false;
  }
  return ticketFinalizerOpenRequest(
    service,
    claim,
    repository,
    base,
    candidate,
    headRef,
  );
}

function ticketFinalizerOpenRequest(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim,
  repository: RepositoryBinding,
  base: ObservedTarget,
  candidate: ReturnType<typeof asGitObjectId>,
  headRef: ReturnType<typeof asGitRefName>,
): Promise<boolean> {
  const digest = service.identities(claim).request;
  const marker = proposalMarkerOf(digest);
  const forge = service.forges.binding(repository.repository);
  if (forge === undefined) return Promise.resolve(false);
  return service.store.initialize(
    claim,
    changeProposalRequest({
      binding: {
        forge: forge.forge as never,
        credential: forge.credential as never,
      },
      partition: claim.partition,
      repository: repository.repository,
      request: digest,
      headRef,
      headCommit: candidate,
      baseRef: base.ref,
      baseCommit: base.commit,
      title: `Ticket ${String(claim.obligation.ticket)}`,
      body: `Automated finalization for ticket ${String(claim.obligation.ticket)}.\n\n${marker}`,
    }),
  );
}

function creationState(
  answer: Awaited<ReturnType<ChangeProposalPort["create"]>>,
): ChangeProposalCreationStored | undefined {
  return "evidence" in answer ? answer : undefined;
}

function mergeAnswer(
  answer: Awaited<ReturnType<ChangeProposalPort["merge"]>>,
): ChangeProposalMergeAnswer | undefined {
  if (answer.merged === "Merged" || answer.merged === "HeadMoved")
    return answer;
  if (answer.merged !== "NotMergeable") return undefined;
  return answer.reason === "Conflict" || answer.reason === "Blocked"
    ? { merged: "NotMergeable", reason: answer.reason }
    : undefined;
}

/** Reports what a finished finalization came to, whichever operation finished it. */
async function ticketFinalizerReported(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim,
  completion: NonNullable<TicketFinalizerClaim["completion"]>,
): Promise<boolean> {
  const accepted = await service.inbox.submit(
    claim.partition,
    `finalizer:${claim.identity}`,
    ticketFinalizationReport(
      claim.obligation,
      completion.outcome,
      completion.evidence,
    ),
  );
  return accepted && service.store.reported(claim);
}

async function ticketFinalizerPullRequest(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim,
  configuration: TicketPullRequestConfiguration,
): Promise<boolean> {
  if (claim.repository === undefined)
    return ticketFinalizerInitialize(service, claim, configuration);
  if (claim.request === undefined)
    return ticketFinalizerPublish(service, claim);
  const port = service.forges.proposal(claim.request.binding.forge);
  if (port === undefined) return false;
  const next = ticketPullRequestNext(
    {
      configuration,
      request: claim.request,
      publication: claim.publication,
      merging: claim.merging,
    },
    service.bounds,
  );
  return ticketFinalizerProposalAdvance(
    service,
    { ...claim, request: claim.request },
    port,
    next,
  );
}

/** The operation the ticket's configuration names, which is what selects the path below. */
async function ticketFinalizerAdvance(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim,
): Promise<boolean> {
  if (claim.completion !== undefined)
    return ticketFinalizerReported(service, claim, claim.completion);
  const found = await service
    .contents(claim.partition)
    .read(claim.obligation.configuration);
  if (found?.mediaType !== "application/json") return false;
  const configuration = parsedConfiguration(found.content);
  switch (configuration.operation) {
    case "pull-request":
      return ticketFinalizerPullRequest(service, claim, configuration);
    case "git-merge":
      return ticketFinalizerGitMerge(service, claim, configuration);
    case "no-op":
      return ticketFinalizerCompleted(service, claim, "Succeeded", {
        landed: "Nothing",
      });
    default:
      return assertNever(configuration);
  }
}

async function ticketFinalizerProposalAdvance(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim & { readonly request: ChangeProposalRequest },
  port: ChangeProposalPort,
  next: ReturnType<typeof ticketPullRequestNext>,
): Promise<boolean> {
  switch (next.step) {
    case "Create":
    case "ReadPublication":
    case "RefuseCreation":
      return ticketFinalizerPublicationAdvance(service, claim, port, {
        step: next.step,
      });
    case "Merge":
    case "ReadMerge":
      return ticketFinalizerMergeAdvance(service, claim, port, next);
    case "RefuseMerge":
      return ticketFinalizerMergeAdvance(service, claim, port, {
        step: "RefuseMerge",
      });
    case "Complete":
      return ticketFinalizerCompleted(
        service,
        claim,
        next.outcome,
        next.evidence,
      );
    default:
      return assertNever(next);
  }
}

async function ticketFinalizerPublicationAdvance(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim & { readonly request: ChangeProposalRequest },
  port: ChangeProposalPort,
  next: { readonly step: "Create" | "ReadPublication" | "RefuseCreation" },
): Promise<boolean> {
  switch (next.step) {
    case "Create": {
      const inFlight: ChangeProposalPublication = {
        publication: "Unanswered",
        creations:
          claim.publication.publication === "Idle"
            ? claim.publication.creations + 1
            : 1,
        reconciliations: 0,
        reading: undefined,
      };
      if (!(await service.store.publication(claim, inFlight))) return false;
      const answer = await port.create(claim.request);
      const settled = creationState(answer);
      if (answer.created === "Denied" || answer.created === "Unavailable")
        return service.store.publication(claim, {
          publication: "Idle",
          creations: inFlight.creations,
        });
      return (
        settled === undefined ||
        service.store.publication(claim, {
          publication: "Answered",
          creation: settled,
        })
      );
    }
    case "ReadPublication": {
      const current = claim.publication;
      if (current.publication !== "Unanswered") return false;
      const reconciled = reconcileChangeProposal(
        claim.request,
        await port.readByMarker(claim.request),
        "Accepted",
      );
      const reading: ChangeProposalReconciliationStored | undefined =
        reconciled.reconciled === "Unavailable" ||
        reconciled.reconciled === "Denied"
          ? undefined
          : reconciled;
      return service.store.publication(claim, {
        ...current,
        reconciliations: current.reconciliations + 1,
        ...(reading === undefined ? {} : { reading }),
      });
    }
    case "RefuseCreation": {
      const current = claim.publication;
      return (
        current.publication === "Unanswered" &&
        service.store.publication(claim, {
          publication: "Idle",
          creations: current.creations,
        })
      );
    }
    default:
      throw new Error("unknown publication step");
  }
}

async function ticketFinalizerMergeAdvance(
  service: TicketFinalizerService,
  claim: TicketFinalizerClaim & { readonly request: ChangeProposalRequest },
  port: ChangeProposalPort,
  next:
    | Extract<
        ReturnType<typeof ticketPullRequestNext>,
        { readonly step: "Merge" | "ReadMerge" }
      >
    | { readonly step: "RefuseMerge" },
): Promise<boolean> {
  switch (next.step) {
    case "Merge": {
      const inFlight: ChangeProposalMerging = {
        merging: "Unanswered",
        merges: claim.merging.merging === "Idle" ? claim.merging.merges + 1 : 1,
        readings: 0,
        reading: undefined,
      };
      if (!(await service.store.merging(claim, inFlight))) return false;
      const merged = await port.merge(next.request);
      if (merged.merged === "Denied" || merged.merged === "Unavailable")
        return service.store.merging(claim, {
          merging: "Idle",
          merges: inFlight.merges,
        });
      const answer = mergeAnswer(merged);
      return (
        answer === undefined ||
        service.store.merging(claim, { merging: "Answered", merge: answer })
      );
    }
    case "ReadMerge": {
      const current = claim.merging;
      if (current.merging !== "Unanswered") return false;
      const reconciled = reconcileChangeProposalMerge(
        claim.request,
        await port.readByNumber(next.request),
      );
      const reading: ChangeProposalMergeReconciliationStored | undefined =
        reconciled.reconciled === "Unavailable" ||
        reconciled.reconciled === "Denied"
          ? undefined
          : reconciled;
      return service.store.merging(claim, {
        ...current,
        readings: current.readings + 1,
        ...(reading === undefined ? {} : { reading }),
      });
    }
    case "RefuseMerge": {
      const current = claim.merging;
      return (
        current.merging === "Unanswered" &&
        service.store.merging(claim, {
          merging: "Idle",
          merges: current.merges,
        })
      );
    }
    default:
      return assertNever(next);
  }
}

export function ticketFinalizerRegistration(store: TicketFinalizerStore) {
  return {
    finalize: (
      partition: Partition,
      identity: string,
      obligation: FinalizeTicket,
    ) => store.register(partition, identity, obligation),
  };
}

export async function ticketFinalizerPass(
  service: TicketFinalizerService,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new RangeError("ticket finalizer limit is outside its bounds");
  let advanced = 0;
  for (let index = 0; index < limit; index += 1) {
    const claim = await service.store.claim(
      service.owner,
      service.leaseMs,
      service.recoveryEpoch,
    );
    if (claim === undefined) break;
    try {
      if (await ticketFinalizerAdvance(service, claim)) advanced += 1;
    } finally {
      await service.store.release(claim);
    }
  }
  return advanced;
}
