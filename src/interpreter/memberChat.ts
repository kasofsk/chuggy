/**
 * A member's own chat: the thread they open with no project selected, what it
 * may read of them, and their threads across their tenant.
 *
 * EVERY DOOR ASKS THE TENANT FIRST. `OpenUnscopedChat` is what the tenant
 * grants and takes away, and every read and write here asks it before reaching
 * a store, so a member whose grant is taken loses their own chat at once,
 * history included, without a row being touched.
 *
 * THEIR OWN THREADS ARE REACHED THROUGH THE PROJECT THREAD DOORS. A member's
 * own thread lives in the partition reserved for them, so every door a project
 * thread has is reused over an access that admits that partition to its owner,
 * on the tenant's grant, and refuses every other: no other member is admitted
 * to it, and no project is reached through it. Opening and sending are this
 * module's own, because their texts differ: the objectives name no project and
 * the first turn is seeded with nothing.
 *
 * A PROJECT IS SEEN AS `ChatMetadata` ADMITS IT, AND ONLY AS METADATA. Which
 * projects the chat lists, and which of its owner's project threads it lists,
 * are asked of that permit; no door reads a project thread's turns, which can
 * quote the project's repositories.
 *
 * EVERY PROJECT IS ASKED IN TURN. A listing asks its projects one at a time,
 * as the project inventory does, and a role stops at the strongest permit
 * held, so one request holds one question open at the authority.
 */

import type { AccessProjectRole } from "../contract/accessPlane.ts";
import type { ChatAbilitiesResponse } from "../contract/responses.ts";
import {
  nativeHttpPageItemsMax,
  threadsAnsweredMax,
} from "../contract/http.ts";
import {
  memberScopePartition,
  type SessionId,
  type SessionScope,
  type SessionTurnId,
} from "./agentSession.ts";
import type { LeadTranscriptQuery, LeadTranscriptRead } from "./leadRead.ts";
import { nativeThreadMethods, type NativeThreadPorts } from "./nativeWeb.ts";
import type { Authority } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
  type ProjectAccessKind,
} from "./projectAccess.ts";
import type {
  Lifecycle,
  Partition,
  ProjectId,
  TenantId,
} from "./projectStore.ts";
import {
  sessionSpendRoute,
  type SessionRouteReads,
} from "./sessionPlacement.ts";
import {
  memberThreadSystemPrompt,
  threadTurnInput,
  threadTurnInputCharsMax,
} from "./thread.ts";
import {
  checkedThreadMessage,
  checkedThreadMessageImages,
  threadEntry,
  threadMessageSent,
  type MemberThreadRecord,
  type ThreadClosing,
  type ThreadEntry,
  type ThreadHiding,
  type ThreadMailboxQuery,
  type ThreadMessageSent,
  type ThreadOpening,
  type ThreadOpenKey,
  type ThreadRead,
  type ThreadRenaming,
  type ThreadTurnStopping,
} from "./threadRead.ts";

/** One project of a tenant as its store lists it. */
export interface MemberChatProjectRow {
  readonly project: ProjectId;
  readonly lifecycle: Lifecycle;
}

/** A tenant's projects in identity order, after `after`, none in retention. */
export interface MemberChatProjectStore {
  projects(
    tenant: TenantId,
    after: ProjectId | undefined,
    limit: number,
  ): Promise<readonly MemberChatProjectRow[]>;
}

/** One project the chat may see, and the strongest role its owner holds there. */
export interface MemberChatProject extends MemberChatProjectRow {
  readonly role: AccessProjectRole;
}

export type MemberChatProjectsRead =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly projects: readonly MemberChatProject[];
      readonly nextAfter?: ProjectId;
    };

/** One of a member's threads as their chat lists it: whose scope it is in, and the project that keeps it where one does. */
export interface MemberChatThreadEntry extends ThreadEntry {
  readonly scope: SessionScope;
  readonly project?: ProjectId;
}

export type MemberChatThreadsRead =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly threads: readonly MemberChatThreadEntry[];
    };

/** Every door of a member's own chat, each at their tenant. */
export interface MemberChat {
  /** Whether the tenant lets `principal` open unscoped chat, which every door of it, and every read of their own session's bearer, asks first. */
  opens(principal: Principal, tenant: TenantId): Promise<boolean>;
  abilities(
    principal: Principal,
    tenant: TenantId,
  ): Promise<ChatAbilitiesResponse>;
  projects(
    principal: Principal,
    tenant: TenantId,
    query: { readonly after?: ProjectId; readonly limit: number },
  ): Promise<MemberChatProjectsRead>;
  threads(
    principal: Principal,
    tenant: TenantId,
  ): Promise<MemberChatThreadsRead>;
  thread(
    principal: Principal,
    tenant: TenantId,
    session: SessionId,
    query: ThreadMailboxQuery,
  ): Promise<ThreadRead>;
  threadTranscript(
    principal: Principal,
    tenant: TenantId,
    session: SessionId,
    query: LeadTranscriptQuery,
  ): Promise<LeadTranscriptRead>;
  openThread(
    principal: Principal,
    tenant: TenantId,
    key: ThreadOpenKey,
  ): Promise<ThreadOpening>;
  sendThreadMessage(
    principal: Principal,
    tenant: TenantId,
    input: {
      readonly session: SessionId;
      readonly turn: SessionTurnId;
      readonly message: string;
      readonly images?: readonly string[];
    },
  ): Promise<ThreadMessageSent>;
  stopThreadTurn(
    principal: Principal,
    tenant: TenantId,
    input: { readonly session: SessionId; readonly turn: SessionTurnId },
  ): Promise<ThreadTurnStopping>;
  closeThread(
    principal: Principal,
    tenant: TenantId,
    session: SessionId,
  ): Promise<ThreadClosing>;
  renameThread(
    principal: Principal,
    tenant: TenantId,
    input: { readonly session: SessionId; readonly title: string },
  ): Promise<ThreadRenaming>;
  hideThread(
    principal: Principal,
    tenant: TenantId,
    input: { readonly session: SessionId; readonly hidden: boolean },
  ): Promise<ThreadHiding>;
}

/** The roles a project's permits read as, strongest first, the last held by every reader. */
const memberChatRoleKinds: readonly (readonly [
  AccessProjectRole,
  ProjectAccessKind,
])[] = [
  ["Admin", "Administer"],
  ["Developer", "Mutate"],
  ["Dispatcher", "DispatchTicket"],
];

/** Whether the tenant lets `principal` open unscoped chat, as the authority it acts under. */
async function memberChatGranted(
  access: ProjectAccess,
  principal: Principal,
  tenant: TenantId,
): Promise<Authority | undefined> {
  return (await access.authorizeTenant(
    principal,
    tenant,
    "OpenUnscopedChat",
  )) === undefined
    ? undefined
    : memberAuthority(principal);
}

/**
 * The access a member's own partition is asked of: there, any kind is its
 * owner's alone and only on the tenant's grant; anywhere else, nothing. The
 * tenant and site questions are the access's own.
 */
export function memberChatAccess(access: ProjectAccess): ProjectAccess {
  return {
    authorize: (principal, partition) =>
      memberScopePartition(partition.tenant, principal).project ===
      partition.project
        ? memberChatGranted(access, principal, partition.tenant)
        : Promise.resolve(undefined),
    authorizeTenant: (principal, tenant, kind) =>
      access.authorizeTenant(principal, tenant, kind),
    authorizeSite: (principal, kind) => access.authorizeSite(principal, kind),
  };
}

/** The strongest role `principal` holds on a project they may see, asked strongest first. */
async function memberChatRole(
  access: ProjectAccess,
  principal: Principal,
  partition: Partition,
): Promise<AccessProjectRole> {
  for (const [role, kind] of memberChatRoleKinds)
    if ((await access.authorize(principal, partition, kind)) !== undefined)
      return role;
  return "Viewer";
}

export function checkedMemberChatProjectsLimit(limit: number): number {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > nativeHttpPageItemsMax
  )
    throw new RangeError(
      `a project listing answers between 1 and ${String(nativeHttpPageItemsMax)} projects`,
    );
  return limit;
}

/**
 * One page of the tenant's projects, those the chat may see kept: a page
 * scans `limit` of the tenant's projects and may keep fewer, and its cursor is
 * the last it scanned, so a caller walks on until a page names none.
 */
function memberChatProjectsMethod(
  access: ProjectAccess,
  store: MemberChatProjectStore,
): MemberChat["projects"] {
  return async (principal, tenant, query) => {
    if ((await memberChatGranted(access, principal, tenant)) === undefined)
      return { result: "NotFound" };
    const limit = checkedMemberChatProjectsLimit(query.limit);
    const scanned = await store.projects(tenant, query.after, limit);
    const seen: MemberChatProject[] = [];
    for (const row of scanned) {
      const partition = { tenant, project: row.project };
      if (
        (await access.authorize(principal, partition, "ChatMetadata")) !==
        undefined
      )
        seen.push({
          ...row,
          role: await memberChatRole(access, principal, partition),
        });
    }
    const last = scanned.at(-1)?.project;
    return {
      result: "Found",
      projects: seen,
      ...(scanned.length < limit || last === undefined
        ? {}
        : { nextAfter: last }),
    };
  };
}

/** The projects of `records` the chat may see, each asked once. */
async function memberChatProjectsSeen(
  access: ProjectAccess,
  principal: Principal,
  tenant: TenantId,
  records: readonly MemberThreadRecord[],
): Promise<ReadonlySet<ProjectId>> {
  const projects = [
    ...new Set(
      records
        .filter((record) => record.scope === "Project")
        .map((record) => record.project),
    ),
  ];
  const seen = new Set<ProjectId>();
  for (const project of projects)
    if (
      (await access.authorize(
        principal,
        { tenant, project },
        "ChatMetadata",
      )) !== undefined
    )
      seen.add(project);
  return seen;
}

/** The member's threads across their tenant, their own and each project's they may still see, as the wire names them. */
function memberChatThreadsMethod(
  access: ProjectAccess,
  threads: NativeThreadPorts,
): MemberChat["threads"] {
  return async (principal, tenant) => {
    const authority = await memberChatGranted(access, principal, tenant);
    if (authority === undefined) return { result: "NotFound" };
    const records = await threads.threads.memberThreads({
      tenant,
      principal,
      limit: threadsAnsweredMax,
    });
    const seen = await memberChatProjectsSeen(
      access,
      principal,
      tenant,
      records,
    );
    return {
      result: "Found",
      threads: records
        .filter(
          (record) => record.scope === "Member" || seen.has(record.project),
        )
        .map((record) => ({
          ...threadEntry(record, principal, authority.subject),
          scope: record.scope,
          ...(record.scope === "Project" ? { project: record.project } : {}),
        })),
    };
  };
}

/**
 * Opening one of the member's own threads, idempotent on the key its client
 * minted and held to their thread limit by the definer, and refused where no
 * chat host of theirs would take its first turn.
 */
function memberChatOpenMethod(
  access: ProjectAccess,
  threads: NativeThreadPorts,
  routes: SessionRouteReads,
): MemberChat["openThread"] {
  return async (principal, tenant, key) => {
    const own = memberScopePartition(tenant, principal);
    const authority = await access.authorize(principal, own, "Mutate");
    if (authority === undefined) return { result: "NotFound" };
    const spend = await sessionSpendRoute(
      access,
      routes,
      principal,
      own,
      "Thread",
    );
    if (spend.spend !== "Admitted") return { result: spend.spend };
    const opened = await threads.threads.openUnscoped({
      partition: own,
      principal,
      session: threads.sessions.session(),
      key,
      systemPrompt: memberThreadSystemPrompt({
        tenant,
        owner: authority.subject,
      }),
      credentialSlot: threads.credentialSlot,
    });
    if (opened.opened === "ThreadLimitReached")
      return { result: opened.opened, threadsMax: opened.threadsMax };
    return {
      result: opened.opened,
      thread: threadEntry(opened.thread, principal, authority.subject),
    };
  };
}

/**
 * The message door of the member's own thread, which is theirs alone: no
 * seeding block, because no project's texts bind it, and no image, because no
 * project's artifacts are its own to name.
 */
function memberChatSendMethod(
  access: ProjectAccess,
  threads: NativeThreadPorts,
  routes: SessionRouteReads,
): MemberChat["sendThreadMessage"] {
  return async (principal, tenant, input) => {
    const own = memberScopePartition(tenant, principal);
    if ((await access.authorize(principal, own, "Mutate")) === undefined)
      return { result: "NotFound" };
    const spend = await sessionSpendRoute(
      access,
      routes,
      principal,
      own,
      "Thread",
    );
    if (spend.spend !== "Admitted") return { result: spend.spend };
    const message = checkedThreadMessage(input.message);
    if (checkedThreadMessageImages(input.images ?? []).length > 0)
      return { result: "ImageUnknown" };
    const mine = await threads.threads.standing({
      partition: own,
      session: input.session,
      query: { limit: 1 },
    });
    if (mine === undefined) return { result: "NotFound" };
    if (mine.thread.principal !== principal) return { result: "NotYourThread" };
    if (mine.thread.state === "Closed") return { result: "Closed" };
    let turnInput: string;
    try {
      turnInput = threadTurnInput(message);
    } catch (failure) {
      if (failure instanceof RangeError)
        return { result: "TooLarge", charsMax: threadTurnInputCharsMax };
      throw failure;
    }
    return threadMessageSent(
      await threads.threads.enqueueMessage({
        partition: own,
        principal,
        session: input.session,
        turn: input.turn,
        input: turnInput,
        route: spend.route,
      }),
      input.turn,
    );
  };
}

/** A member's own chat over the ports a project's threads are served through. */
export function memberChat(
  access: ProjectAccess,
  threads: NativeThreadPorts,
  routes: SessionRouteReads,
  projects: MemberChatProjectStore,
): MemberChat {
  const own = memberChatAccess(access);
  const doors = nativeThreadMethods(own, threads, routes);
  const at = (principal: Principal, tenant: TenantId) =>
    memberScopePartition(tenant, principal);
  return {
    opens: async (principal, tenant) =>
      (await memberChatGranted(access, principal, tenant)) !== undefined,
    abilities: async (principal, tenant) => {
      const held = async (
        kind: Parameters<ProjectAccess["authorizeTenant"]>[2],
      ) =>
        (await access.authorizeTenant(principal, tenant, kind)) !== undefined;
      const [
        openUnscopedChat,
        executeHosted,
        registerPersonalRunner,
        administerTenant,
      ] = await Promise.all([
        held("OpenUnscopedChat"),
        held("ExecuteHosted"),
        held("RegisterPersonalRunner"),
        held("AdministerTenant"),
      ]);
      return {
        principal,
        openUnscopedChat,
        executeHosted,
        registerPersonalRunner,
        administerTenant,
      };
    },
    projects: memberChatProjectsMethod(access, projects),
    threads: memberChatThreadsMethod(access, threads),
    thread: (principal, tenant, session, query) =>
      doors.thread(principal, at(principal, tenant), session, query),
    threadTranscript: (principal, tenant, session, query) =>
      doors.threadTranscript(principal, at(principal, tenant), session, query),
    openThread: memberChatOpenMethod(own, threads, routes),
    sendThreadMessage: memberChatSendMethod(own, threads, routes),
    stopThreadTurn: (principal, tenant, input) =>
      doors.stopThreadTurn(principal, at(principal, tenant), input),
    closeThread: (principal, tenant, session) =>
      doors.closeThread(principal, at(principal, tenant), session),
    renameThread: (principal, tenant, input) =>
      doors.renameThread(principal, at(principal, tenant), input),
    hideThread: (principal, tenant, input) =>
      doors.hideThread(principal, at(principal, tenant), input),
  };
}
