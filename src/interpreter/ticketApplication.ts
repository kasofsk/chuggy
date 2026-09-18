import * as task from "../domain/chuggernaut/task.js";
import * as ticket from "../domain/chuggernaut/ticket.js";
import type { Principal } from "./principal.ts";
import type { Authority } from "./operationInbox.ts";
import type { GitObjectId, RepositoryId } from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectAccess, ProjectAccessKind } from "./projectAccess.ts";
import {
  ticketCatalogReferenceRefusal,
  ticketCatalogRoot,
  type TicketCatalog,
  type TicketCatalogEntry,
  type TicketCatalogFragments,
  type TicketCatalogRelease,
  type TicketCatalogSnapshotRead,
  type TicketCatalogTip,
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
      readonly code: "ReworkLimitChanged" | "CatalogCommitStale";
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
  /** Where the bound repository stands now, which is what every request pins to. */
  tip(selection: {
    readonly partition: Partition;
    readonly repository?: RepositoryId;
  }): Promise<TicketCatalogTip | undefined>;
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

/**
 * Which catalog a request works against: the server resolves the bound
 * repository's tip itself rather than being told one, so provenance is recorded
 * rather than supplied. `expectedCatalogCommit` is the commit the caller last
 * saw, and a write is refused when the tree has moved past it — the shape the
 * update path's `If-Match` revision already has.
 */
export interface TicketCatalogRequest {
  readonly partition: Partition;
  readonly repository?: RepositoryId;
  readonly expectedCatalogCommit?: GitObjectId;
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
  /** What the server resolved against, so a write can send it back as its guard. */
  readonly commit: GitObjectId;
}

export interface TicketCatalogEntries {
  readonly entries: readonly TicketCatalogEntry[];
}

export interface TicketCatalogFile extends TicketCatalogEntry {
  readonly content: string;
}

/**
 * What writing or removing a runtime fragment came to. A refusal carries the
 * sentence a caller is shown, because the reason it names — a reference the
 * repository already holds — is the caller's to act on.
 */
export type TicketCatalogWrite =
  | { readonly written: "Written" | "Removed" | "NotHeld" }
  | { readonly written: "Refused"; readonly message: string };

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
    path: string,
  ): Promise<TicketApplicationResult<TicketCatalogFile | undefined>>;
  writeCatalogFile(
    principal: Principal,
    request: TicketCatalogRequest,
    path: string,
    content: string,
  ): Promise<TicketApplicationResult<TicketCatalogWrite | undefined>>;
  removeCatalogFile(
    principal: Principal,
    request: TicketCatalogRequest,
    path: string,
  ): Promise<TicketApplicationResult<TicketCatalogWrite | undefined>>;
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
  readonly fragments: TicketCatalogFragments;
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
  selection: PinnedTicketCatalogSelection,
): TicketReleaseMetadata {
  return {
    stageNames: [...release.stageNames].map(([key, name]) => [key, name]),
    evaluatorNames: [...release.evaluatorNames].map(([key, name]) => [
      key,
      name,
    ]),
    reworkLimit: release.reworkLimit,
    source,
    catalogCommit: selection.commit,
  };
}

function ticketApplicationUpdateMetadata(
  release: TicketCatalogRelease,
  frozen: TicketReleaseMetadata,
  source: task.ContentRef,
  selection: PinnedTicketCatalogSelection,
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
    ...ticketApplicationMetadata(release, source, selection),
    reworkLimit: frozen.reworkLimit,
  };
}

/**
 * What one request pins to. `Unbound` is a project with no reachable binding
 * to resolve against, which a caller sees as a catalog that is not there;
 * `Stale` is the guard the caller sent back failing, which is a refusal it can
 * act on by reading the catalog again.
 */
type TicketApplicationPin =
  | {
      readonly pinned: "Pinned";
      readonly selection: PinnedTicketCatalogSelection;
    }
  | { readonly pinned: "Unbound" }
  | { readonly pinned: "Stale"; readonly message: string };

async function ticketApplicationPin(
  ports: TicketApplicationPorts,
  request: TicketCatalogRequest,
  guarded: boolean,
): Promise<TicketApplicationPin> {
  const repository =
    request.repository === undefined ? {} : { repository: request.repository };
  const tip = await ports.catalogs.tip({
    partition: request.partition,
    ...repository,
  });
  if (tip === undefined) return { pinned: "Unbound" };
  const expected = request.expectedCatalogCommit;
  if (guarded && expected !== undefined && expected !== tip.commit)
    return {
      pinned: "Stale",
      message: `the catalog has moved from ${expected} to ${tip.commit}`,
    };
  return {
    pinned: "Pinned",
    selection: {
      partition: request.partition,
      commit: tip.commit,
      repository: tip.repository,
    },
  };
}

/** The guarded pin and the catalog over it, or the answer the caller gets instead. */
type TicketApplicationOpened =
  | {
      readonly opened: "Catalog";
      readonly catalog: TicketCatalog;
      readonly selection: PinnedTicketCatalogSelection;
    }
  | {
      readonly opened: "Answered";
      readonly result: TicketApplicationResult<TicketApplicationSubmission>;
    };

async function ticketApplicationCatalog(
  ports: TicketApplicationPorts,
  request: TicketAuthoringRequest,
): Promise<TicketApplicationOpened> {
  const pin = await ticketApplicationPin(ports, request, true);
  if (pin.pinned === "Unbound")
    return { opened: "Answered", result: { result: "NotFound" } };
  if (pin.pinned === "Stale")
    return {
      opened: "Answered",
      result: {
        result: "Authorized",
        value: {
          accepted: "AuthoringRefused",
          code: "CatalogCommitStale",
          message: pin.message,
        },
      },
    };
  const catalog = await ports.catalogs.catalog(pin.selection);
  return catalog === undefined
    ? { opened: "Answered", result: { result: "NotFound" } }
    : { opened: "Catalog", catalog, selection: pin.selection };
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
    const pin = await ticketApplicationPin(ports, request, false);
    if (pin.pinned !== "Pinned") return { result: "NotFound" };
    const commit = pin.selection.commit;
    const catalog = await ports.catalogs.draft(pin.selection);
    if (catalog === undefined) return { result: "NotFound" };
    try {
      await catalog.release(ticketValidationIdentity, request.source);
      return {
        result: "Authorized",
        value: { valid: true, findings: [], commit },
      };
    } catch (error) {
      return {
        result: "Authorized",
        value: {
          valid: false,
          findings: [ticketApplicationFinding(error)],
          commit,
        },
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
  if (authorization === undefined) return "Unauthorized";
  const pin = await ticketApplicationPin(ports, request, false);
  return pin.pinned === "Pinned"
    ? ports.catalogs.snapshot(pin.selection)
    : undefined;
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
      value: { entries: ticketApplicationSorted(await pinned.entries()) },
    };
  };
}

/** By reference, so a reader sees one namespace rather than the two it was merged from. */
function ticketApplicationSorted(
  entries: readonly TicketCatalogEntry[],
): readonly TicketCatalogEntry[] {
  return [...entries].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function ticketApplicationCatalogFile(
  ports: TicketApplicationPorts,
): TicketApplication["catalogFile"] {
  return async (principal, request, path) => {
    const pinned = await ticketApplicationSnapshot(ports, principal, request);
    if (pinned === "Unauthorized") return { result: "NotFound" };
    if (pinned === undefined) return { result: "Authorized", value: undefined };
    const entry = (await pinned.entries()).find((held) => held.path === path);
    if (entry === undefined) return { result: "Authorized", value: undefined };
    return {
      result: "Authorized",
      value: {
        ...entry,
        content: await pinned.snapshot.read(`${ticketCatalogRoot}${path}`),
      },
    };
  };
}

/**
 * A runtime fragment may introduce a reference the repository does not hold and
 * may never shadow one it does, so a colliding write is refused here rather
 * than accepted into a row that would never resolve.
 */
async function ticketApplicationFragmentRefusal(
  ports: TicketApplicationPorts,
  request: TicketCatalogRequest,
  path: string,
): Promise<TicketCatalogWrite | undefined | "NotFound"> {
  const refused = ticketCatalogReferenceRefusal(path);
  if (refused !== undefined) return { written: "Refused", message: refused };
  const pin = await ticketApplicationPin(ports, request, true);
  if (pin.pinned === "Unbound") return "NotFound";
  if (pin.pinned === "Stale")
    return { written: "Refused", message: pin.message };
  const pinned = await ports.catalogs.snapshot(pin.selection);
  if (pinned === undefined) return "NotFound";
  const committed = (await pinned.entries()).some(
    (entry) => entry.path === path && entry.origin === "Git",
  );
  return committed
    ? {
        written: "Refused",
        message: `the repository already holds ${path}; a runtime fragment may not shadow it`,
      }
    : undefined;
}

function ticketApplicationCatalogWrite(
  ports: TicketApplicationPorts,
): TicketApplication["writeCatalogFile"] {
  return async (principal, request, path, content) => {
    const authorization = await ticketApplicationAuthority(
      ports,
      principal,
      request.partition,
      "Mutate",
    );
    if (authorization === undefined) return { result: "NotFound" };
    const refusal = await ticketApplicationFragmentRefusal(
      ports,
      request,
      path,
    );
    if (refusal === "NotFound") return { result: "NotFound" };
    if (refusal !== undefined) return { result: "Authorized", value: refusal };
    await ports.fragments.write(request.partition, path, content);
    return { result: "Authorized", value: { written: "Written" } };
  };
}

/**
 * Removing needs no repository read: a fragment shadowed by a later commit is
 * exactly the row an operator removes, and refusing that would strand it.
 */
function ticketApplicationCatalogRemove(
  ports: TicketApplicationPorts,
): TicketApplication["removeCatalogFile"] {
  return async (principal, request, path) => {
    const authorization = await ticketApplicationAuthority(
      ports,
      principal,
      request.partition,
      "Mutate",
    );
    if (authorization === undefined) return { result: "NotFound" };
    const refused = ticketCatalogReferenceRefusal(path);
    if (refused !== undefined)
      return {
        result: "Authorized",
        value: { written: "Refused", message: refused },
      };
    const removed = await ports.fragments.remove(request.partition, path);
    return {
      result: "Authorized",
      value: { written: removed ? "Removed" : "NotHeld" },
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
    const opened = await ticketApplicationCatalog(ports, request);
    if (opened.opened === "Answered") return opened.result;
    const release = await opened.catalog.release(
      reservation.ticket,
      request.source,
    );
    return ticketApplicationSubmit(
      ports,
      request,
      authorization,
      new ticket.CreateTicket(release.definition),
      ticketApplicationMetadata(
        release,
        await ticketApplicationSource(ports, request),
        opened.selection,
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
    const opened = await ticketApplicationCatalog(ports, request);
    if (opened.opened === "Answered") return opened.result;
    const release = await opened.catalog.release(
      request.ticket,
      request.source,
    );
    const frozen = await ports.inbox.releaseMetadata(
      request.partition,
      request.ticket,
    );
    if (frozen === undefined) return { result: "NotFound" };
    const metadata = ticketApplicationUpdateMetadata(
      release,
      frozen,
      await ticketApplicationSource(ports, request),
      opened.selection,
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
    writeCatalogFile: ticketApplicationCatalogWrite(ports),
    removeCatalogFile: ticketApplicationCatalogRemove(ports),
    create: ticketApplicationCreate(ports),
    update: ticketApplicationUpdate(ports),
    dispatch: ticketApplicationDispatch(ports),
    revoke: ticketApplicationAction(ports, "Revoke"),
    resume: ticketApplicationAction(ports, "Resume"),
  };
}
