import * as task from "../domain/chuggernaut/task.js";
import * as ticket from "../domain/chuggernaut/ticket.js";
import type { Principal } from "./principal.ts";
import type { Authority } from "./operationInbox.ts";
import type { GitObjectId, RepositoryId } from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectAccess, ProjectAccessKind } from "./projectAccess.ts";
import {
  ticketCatalogRoot,
  type TicketCatalog,
  type TicketCatalogRelease,
  type TicketCatalogSnapshotRead,
  type TicketContentStore,
} from "./ticketCatalog.ts";
import type { TicketMachineOutcome } from "./ticketMachine.ts";
import type {
  TicketMachineAuthorization,
  TicketMachineInput,
  TicketMachineReleaseMetadata,
} from "./ticketMachine.ts";
import type {
  TicketMachineAccepted,
  TicketMachineInbox,
} from "./ticketMachineInbox.ts";

export type TicketAuthorization = TicketMachineAuthorization;
export type TicketReleaseMetadata = TicketMachineReleaseMetadata;
export type TicketApplicationInput = TicketMachineInput;

export type TicketApplicationAvailability =
  "LegacyModelUnsupported" | "ProjectNotFound" | "ProjectNotActive";

export type TicketApplicationSubmission =
  | TicketMachineAccepted
  | {
      readonly accepted: "AuthoringRefused";
      readonly code: "ReworkLimitChanged";
      readonly message: string;
    };
export type TicketApplicationInbox = TicketMachineInbox;

export interface PinnedTicketCatalogSelection {
  readonly partition: Partition;
  readonly repository?: RepositoryId;
  readonly commit: GitObjectId;
}

export interface PinnedTicketCatalogs {
  catalog(
    selection: PinnedTicketCatalogSelection,
  ): Promise<TicketCatalog | undefined>;
  /** The same catalog over throwaway content, so validating a draft persists nothing. */
  draft(
    selection: PinnedTicketCatalogSelection,
  ): Promise<TicketCatalog | undefined>;
  /** The pinned tree itself, which an author browses to learn what may be referenced. */
  snapshot(
    selection: PinnedTicketCatalogSelection,
  ): Promise<TicketCatalogSnapshotRead | undefined>;
}

export interface TicketGraphRead {
  read(
    partition: Partition,
  ): Promise<ticket.TicketGraph | "LegacyModelUnsupported" | undefined>;
}

export type TicketApplicationResult<Value> =
  | { readonly result: "NotFound" }
  | { readonly result: "LegacyModelUnsupported" }
  | { readonly result: "Authorized"; readonly value: Value };

export interface TicketCatalogRequest {
  readonly partition: Partition;
  readonly catalogCommit: GitObjectId;
  readonly repository?: RepositoryId;
}

export interface TicketAuthoringRequest extends TicketCatalogRequest {
  readonly identity: string;
  readonly source: string;
}

export interface TicketUpdateRequest extends TicketAuthoringRequest {
  readonly ticket: task.TicketId;
  readonly expectedRevision: number;
}

export interface TicketActionRequest {
  readonly partition: Partition;
  readonly identity: string;
  readonly ticket: task.TicketId;
}

export interface TicketDispatchRequest extends TicketActionRequest {
  readonly repository: string;
  readonly commit: string;
}

export interface TicketValidationRequest extends TicketCatalogRequest {
  readonly source: string;
}

export interface TicketValidation {
  readonly valid: boolean;
  readonly findings: readonly string[];
}

export interface TicketCatalogEntries {
  readonly entries: readonly string[];
}

export interface TicketCatalogFile {
  readonly reference: string;
  readonly content: string;
}

export interface TicketDefinitionRead {
  readonly held: ticket.Ticket;
  /** Absent when the release predates source retention, since nothing can reconstruct it. */
  readonly source: string | undefined;
}

export interface TicketApplication {
  graph(
    principal: Principal,
    partition: Partition,
  ): Promise<TicketApplicationResult<ticket.TicketGraph>>;
  definition(
    principal: Principal,
    partition: Partition,
    held: task.TicketId,
  ): Promise<TicketApplicationResult<TicketDefinitionRead | undefined>>;
  validate(
    principal: Principal,
    request: TicketValidationRequest,
  ): Promise<TicketApplicationResult<TicketValidation>>;
  catalog(
    principal: Principal,
    request: TicketCatalogRequest,
  ): Promise<TicketApplicationResult<TicketCatalogEntries | undefined>>;
  catalogFile(
    principal: Principal,
    request: TicketCatalogRequest,
    reference: string,
  ): Promise<TicketApplicationResult<TicketCatalogFile | undefined>>;
  outcome(
    principal: Principal,
    partition: Partition,
    identity: string,
  ): Promise<TicketApplicationResult<TicketMachineOutcome | undefined>>;
  create(
    principal: Principal,
    request: TicketAuthoringRequest,
  ): Promise<TicketApplicationResult<TicketApplicationSubmission>>;
  update(
    principal: Principal,
    request: TicketUpdateRequest,
  ): Promise<TicketApplicationResult<TicketApplicationSubmission>>;
  dispatch(
    principal: Principal,
    request: TicketDispatchRequest,
  ): Promise<TicketApplicationResult<TicketApplicationSubmission>>;
  revoke(
    principal: Principal,
    request: TicketActionRequest,
  ): Promise<TicketApplicationResult<TicketApplicationSubmission>>;
  resume(
    principal: Principal,
    request: TicketActionRequest,
  ): Promise<TicketApplicationResult<TicketApplicationSubmission>>;
}

interface TicketApplicationPorts {
  readonly access: ProjectAccess;
  readonly inbox: TicketApplicationInbox;
  readonly graphs: TicketGraphRead;
  readonly catalogs: PinnedTicketCatalogs;
  readonly content: (partition: Partition) => TicketContentStore;
}

const ticketApplicationPolicyRevision = "project-access-v1";

function ticketApplicationAuthorization(
  principal: Principal,
  operation: ProjectAccessKind,
  authority: Authority,
): TicketAuthorization {
  return {
    principal,
    authorizedOperation: operation,
    policyRevision: ticketApplicationPolicyRevision,
    authorityKind: authority.kind,
    authoritySubject: authority.subject,
  };
}

async function ticketApplicationAuthority(
  ports: TicketApplicationPorts,
  principal: Principal,
  partition: Partition,
  operation: ProjectAccessKind,
): Promise<TicketAuthorization | undefined> {
  const authority = await ports.access.authorize(
    principal,
    partition,
    operation,
  );
  return authority === undefined
    ? undefined
    : ticketApplicationAuthorization(principal, operation, authority);
}

function ticketApplicationMetadata(
  release: TicketCatalogRelease,
  source: task.ContentRef,
): TicketReleaseMetadata {
  return {
    stageNames: [...release.stageNames].map(([key, name]) => [key, name]),
    evaluatorNames: [...release.evaluatorNames].map(([key, name]) => [
      key,
      name,
    ]),
    reworkLimit: release.reworkLimit,
    source,
  };
}

function ticketApplicationUpdateMetadata(
  release: TicketCatalogRelease,
  frozen: TicketReleaseMetadata,
  source: task.ContentRef,
): TicketReleaseMetadata | TicketApplicationSubmission {
  if (release.reworkLimitDeclared && release.reworkLimit !== frozen.reworkLimit)
    return {
      accepted: "AuthoringRefused",
      code: "ReworkLimitChanged",
      message:
        frozen.reworkLimit === null
          ? "rework_limit cannot be declared because the ticket was released without one"
          : `rework_limit must remain ${String(frozen.reworkLimit)}`,
    };
  return {
    ...ticketApplicationMetadata(release, source),
    reworkLimit: frozen.reworkLimit,
  };
}

function ticketApplicationSelection(
  request: TicketCatalogRequest,
): PinnedTicketCatalogSelection {
  return {
    partition: request.partition,
    commit: request.catalogCommit,
    ...(request.repository === undefined
      ? {}
      : { repository: request.repository }),
  };
}

async function ticketApplicationCatalog(
  ports: TicketApplicationPorts,
  request: TicketAuthoringRequest,
): Promise<TicketCatalog | undefined> {
  return ports.catalogs.catalog(ticketApplicationSelection(request));
}

/** The authored text the machine never sees, kept beside the release it produced. */
function ticketApplicationSource(
  ports: TicketApplicationPorts,
  request: TicketAuthoringRequest,
): Promise<task.ContentRef> {
  return ports
    .content(request.partition)
    .put("application/yaml", request.source);
}

async function ticketApplicationSubmit(
  ports: TicketApplicationPorts,
  request: Pick<TicketActionRequest, "partition" | "identity">,
  authorization: TicketAuthorization,
  command: ticket.TicketCommand,
  release?: TicketReleaseMetadata,
): Promise<TicketApplicationResult<TicketApplicationSubmission>> {
  const submitted = await ports.inbox.submit(request.partition, {
    identity: request.identity,
    origin: "Author",
    authorization,
    command,
    ...(release === undefined ? {} : { metadata: release }),
  });
  if (submitted.accepted === "LegacyModelUnsupported")
    return { result: submitted.accepted };
  if (
    submitted.accepted === "ProjectNotFound" ||
    submitted.accepted === "ProjectNotActive"
  )
    return { result: "NotFound" };
  return { result: "Authorized", value: submitted };
}

/** Any positive identity releases the same document, and a draft release is discarded. */
const ticketValidationIdentity = task.TicketId(1);

function ticketApplicationFinding(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ticketApplicationValidate(
  ports: TicketApplicationPorts,
): TicketApplication["validate"] {
  return async (principal, request) => {
    const authorization = await ticketApplicationAuthority(
      ports,
      principal,
      request.partition,
      "Mutate",
    );
    if (authorization === undefined) return { result: "NotFound" };
    const catalog = await ports.catalogs.draft(
      ticketApplicationSelection(request),
    );
    if (catalog === undefined) return { result: "NotFound" };
    try {
      await catalog.release(ticketValidationIdentity, request.source);
      return { result: "Authorized", value: { valid: true, findings: [] } };
    } catch (error) {
      return {
        result: "Authorized",
        value: { valid: false, findings: [ticketApplicationFinding(error)] },
      };
    }
  };
}

/** The catalog is only ever authored against, so browsing it asks the authoring authority. */
async function ticketApplicationSnapshot(
  ports: TicketApplicationPorts,
  principal: Principal,
  request: TicketCatalogRequest,
): Promise<TicketCatalogSnapshotRead | undefined | "Unauthorized"> {
  const authorization = await ticketApplicationAuthority(
    ports,
    principal,
    request.partition,
    "Mutate",
  );
  return authorization === undefined
    ? "Unauthorized"
    : ports.catalogs.snapshot(ticketApplicationSelection(request));
}

function ticketApplicationCatalogEntries(
  ports: TicketApplicationPorts,
): TicketApplication["catalog"] {
  return async (principal, request) => {
    const pinned = await ticketApplicationSnapshot(ports, principal, request);
    if (pinned === "Unauthorized") return { result: "NotFound" };
    if (pinned === undefined) return { result: "Authorized", value: undefined };
    return {
      result: "Authorized",
      value: { entries: [...(await pinned.entries())].sort() },
    };
  };
}

function ticketApplicationCatalogFile(
  ports: TicketApplicationPorts,
): TicketApplication["catalogFile"] {
  return async (principal, request, reference) => {
    const pinned = await ticketApplicationSnapshot(ports, principal, request);
    if (pinned === "Unauthorized") return { result: "NotFound" };
    if (pinned === undefined) return { result: "Authorized", value: undefined };
    return {
      result: "Authorized",
      value: {
        reference,
        content: await pinned.snapshot.read(`${ticketCatalogRoot}${reference}`),
      },
    };
  };
}

function ticketApplicationDefinition(
  ports: TicketApplicationPorts,
): TicketApplication["definition"] {
  return async (principal, partition, held) => {
    const authorization = await ticketApplicationAuthority(
      ports,
      principal,
      partition,
      "Read",
    );
    if (authorization === undefined) return { result: "NotFound" };
    const graph = await ports.graphs.read(partition);
    if (graph === undefined) return { result: "NotFound" };
    if (graph === "LegacyModelUnsupported") return { result: graph };
    const found = graph.tickets.get(held);
    if (found === undefined) return { result: "Authorized", value: undefined };
    const metadata = await ports.inbox.releaseMetadata(partition, held);
    const reference = metadata?.source;
    const stored =
      reference === undefined
        ? undefined
        : await ports.content(partition).read(task.ContentRef(reference));
    return {
      result: "Authorized",
      value: { held: found, source: stored?.content },
    };
  };
}

function ticketApplicationReads(
  ports: TicketApplicationPorts,
): Pick<TicketApplication, "graph" | "outcome"> {
  return {
    graph: async (principal, partition) => {
      const authorization = await ticketApplicationAuthority(
        ports,
        principal,
        partition,
        "Read",
      );
      if (authorization === undefined) return { result: "NotFound" };
      const graph = await ports.graphs.read(partition);
      if (graph === undefined) return { result: "NotFound" };
      return graph === "LegacyModelUnsupported"
        ? { result: graph }
        : { result: "Authorized", value: graph };
    },
    outcome: async (principal, partition, identity) => {
      const authorization = await ticketApplicationAuthority(
        ports,
        principal,
        partition,
        "Read",
      );
      if (authorization === undefined) return { result: "NotFound" };
      const availability = await ticketApplicationAvailability(
        ports,
        partition,
      );
      if (availability !== "Available") return { result: availability };
      return {
        result: "Authorized",
        value: await ports.inbox.outcome(partition, identity),
      };
    },
  };
}

async function ticketApplicationAvailability(
  ports: TicketApplicationPorts,
  partition: Partition,
): Promise<"Available" | "LegacyModelUnsupported" | "NotFound"> {
  const graph = await ports.graphs.read(partition);
  return graph === undefined
    ? "NotFound"
    : graph === "LegacyModelUnsupported"
      ? graph
      : "Available";
}

function ticketApplicationCreate(
  ports: TicketApplicationPorts,
): TicketApplication["create"] {
  return async (principal, request) => {
    const authorization = await ticketApplicationAuthority(
      ports,
      principal,
      request.partition,
      "Mutate",
    );
    if (authorization === undefined) return { result: "NotFound" };
    const reservation = await ports.inbox.reserveTicket(
      request.partition,
      request.identity,
    );
    if (reservation.reserved !== "Reserved")
      return reservation.reserved === "LegacyModelUnsupported"
        ? { result: reservation.reserved }
        : reservation.reserved === "InputConflict" ||
            reservation.reserved === "Backpressure"
          ? {
              result: "Authorized",
              value: { accepted: reservation.reserved },
            }
          : { result: "NotFound" };
    const catalog = await ticketApplicationCatalog(ports, request);
    if (catalog === undefined) return { result: "NotFound" };
    const release = await catalog.release(reservation.ticket, request.source);
    return ticketApplicationSubmit(
      ports,
      request,
      authorization,
      new ticket.CreateTicket(release.definition),
      ticketApplicationMetadata(
        release,
        await ticketApplicationSource(ports, request),
      ),
    );
  };
}

function ticketApplicationUpdate(
  ports: TicketApplicationPorts,
): TicketApplication["update"] {
  return async (principal, request) => {
    const authorization = await ticketApplicationAuthority(
      ports,
      principal,
      request.partition,
      "Mutate",
    );
    if (authorization === undefined) return { result: "NotFound" };
    const availability = await ticketApplicationAvailability(
      ports,
      request.partition,
    );
    if (availability !== "Available") return { result: availability };
    const catalog = await ticketApplicationCatalog(ports, request);
    if (catalog === undefined) return { result: "NotFound" };
    const release = await catalog.release(request.ticket, request.source);
    const frozen = await ports.inbox.releaseMetadata(
      request.partition,
      request.ticket,
    );
    if (frozen === undefined) return { result: "NotFound" };
    const metadata = ticketApplicationUpdateMetadata(
      release,
      frozen,
      await ticketApplicationSource(ports, request),
    );
    if ("accepted" in metadata)
      return { result: "Authorized", value: metadata };
    return ticketApplicationSubmit(
      ports,
      request,
      authorization,
      new ticket.UpdateTicket(
        request.ticket,
        request.expectedRevision,
        release.definition,
      ),
      metadata,
    );
  };
}

function ticketApplicationDispatch(
  ports: TicketApplicationPorts,
): TicketApplication["dispatch"] {
  return async (principal, request) => {
    const authorization = await ticketApplicationAuthority(
      ports,
      principal,
      request.partition,
      "DispatchTicket",
    );
    if (authorization === undefined) return { result: "NotFound" };
    const availability = await ticketApplicationAvailability(
      ports,
      request.partition,
    );
    if (availability !== "Available") return { result: availability };
    const content = ports.content(request.partition);
    const repository = await content.put("text/plain", request.repository);
    const commit = await content.put("text/plain", request.commit);
    return ticketApplicationSubmit(
      ports,
      request,
      authorization,
      new ticket.DispatchTicket(
        request.ticket,
        new task.WorkspaceSource(repository, task.Digest(commit)),
      ),
    );
  };
}

function ticketApplicationAction(
  ports: TicketApplicationPorts,
  kind: "Revoke" | "Resume",
): TicketApplication["revoke"] {
  return async (principal, request) => {
    const authorization = await ticketApplicationAuthority(
      ports,
      principal,
      request.partition,
      "Mutate",
    );
    return authorization === undefined
      ? { result: "NotFound" }
      : ticketApplicationSubmit(
          ports,
          request,
          authorization,
          kind === "Revoke"
            ? new ticket.RevokeTicket(request.ticket)
            : new ticket.ResumeTicket(request.ticket),
        );
  };
}

export function ticketApplication(
  ports: TicketApplicationPorts,
): TicketApplication {
  return {
    ...ticketApplicationReads(ports),
    definition: ticketApplicationDefinition(ports),
    validate: ticketApplicationValidate(ports),
    catalog: ticketApplicationCatalogEntries(ports),
    catalogFile: ticketApplicationCatalogFile(ports),
    create: ticketApplicationCreate(ports),
    update: ticketApplicationUpdate(ports),
    dispatch: ticketApplicationDispatch(ports),
    revoke: ticketApplicationAction(ports, "Revoke"),
    resume: ticketApplicationAction(ports, "Resume"),
  };
}
