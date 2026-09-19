/** Authenticated interactive sessions, threads, and lead inquiries. */
import {
  asSessionStoreStream,
  isSessionStoreStream,
  type SessionId,
  type SessionStoreStream,
  type SessionTurnId,
} from "./agentSession.ts";
export type { AuthorizedResult } from "./authorizedProject.ts";

import type { Principal } from "./principal.ts";
import {
  leadInquiryAsked,
  leadInquiryEntry,
  leadInquiryTurnInput,
  type LeadInquiriesRead,
  type LeadInquiryAsked,
  type LeadInquiryEntry,
  type LeadInquiryRead,
  type LeadInquiryRecord,
  type LeadInquiryStore,
} from "./leadInquiry.ts";
import type { Partition } from "./projectStore.ts";
import { memberAuthorities } from "./projectAccess.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Authority } from "./operationInbox.ts";
import {
  checkedLeadTranscriptQuery,
  leadTranscriptPage,
  sessionHeldWalk,
  sessionHeldWalkAsks,
  type LeadRead,
  type LeadReadStore,
  type LeadTranscriptQuery,
  type LeadTranscriptRead,
  type SessionHeldWalk,
  type SessionStoreRowsRead,
  type SessionTranscriptSubject,
} from "./leadRead.ts";
import type { SessionStoreReadPort, SessionStoreRead } from "./sessionStore.ts";
import {
  leadTurnsAnsweredMax,
  sessionStoreStreamsAnswered,
} from "../contract/http.ts";
import {
  threadSystemPrompt,
  threadTurnInput,
  threadTurnInputCharsMax,
} from "./thread.ts";
import {
  checkedThreadMailboxQuery,
  checkedThreadMessage,
  checkedThreadsLimit,
  threadEntry,
  threadMessageSent,
  threadSeeding,
  type ThreadClosing,
  type ThreadEntry,
  type ThreadHiding,
  type ThreadRenaming,
  type ThreadMailboxQuery,
  type ThreadMessageSent,
  type ThreadOpening,
  type ThreadRead,
  type ThreadRecord,
  type ThreadSeedingRead,
  type ThreadSessionMint,
  type ThreadStore,
  type ThreadsRead,
} from "./threadRead.ts";
import { inquiriesAnsweredMax, threadsAnsweredMax } from "../contract/http.ts";
import { resolvedThreadStandingRules } from "../contract/threadSeeding.ts";

export { asPublicInstant, type PublicInstant } from "./publicResource.ts";

export { asPrincipal, oidcPrincipal, type Principal } from "./principal.ts";

export {
  allProjectAccessKinds,
  asProjectAccessKind,
  type ProjectAccess,
  type ProjectAccessKind,
} from "./projectAccess.ts";

export interface ProjectInventory {
  projects(
    principal: Principal,
    after: Partition | undefined,
    limit: number,
  ): Promise<ProjectInventoryPage>;
}

export interface ProjectInventoryPage {
  readonly projects: readonly Partition[];
  readonly nextAfter?: Partition;
}

export interface NativeWeb {
  lead(principal: Principal, partition: Partition): Promise<LeadRead>;
  leadTranscript(
    principal: Principal,
    partition: Partition,
    query: LeadTranscriptQuery,
  ): Promise<LeadTranscriptRead>;
  projectInventory(
    principal: Principal,
    after: Partition | undefined,
    limit: number,
  ): Promise<ProjectInventoryPage>;
  threads(principal: Principal, partition: Partition): Promise<ThreadsRead>;
  thread(
    principal: Principal,
    partition: Partition,
    session: SessionId,
    query: ThreadMailboxQuery,
  ): Promise<ThreadRead>;
  threadTranscript(
    principal: Principal,
    partition: Partition,
    session: SessionId,
    query: LeadTranscriptQuery,
  ): Promise<LeadTranscriptRead>;
  openThread(
    principal: Principal,
    partition: Partition,
  ): Promise<ThreadOpening>;
  sendThreadMessage(
    principal: Principal,
    partition: Partition,
    input: {
      readonly session: SessionId;
      readonly turn: SessionTurnId;
      readonly message: string;
    },
  ): Promise<ThreadMessageSent>;
  closeThread(
    principal: Principal,
    partition: Partition,
    session: SessionId,
  ): Promise<ThreadClosing>;
  renameThread(
    principal: Principal,
    partition: Partition,
    input: { readonly session: SessionId; readonly title: string },
  ): Promise<ThreadRenaming>;
  hideThread(
    principal: Principal,
    partition: Partition,
    input: { readonly session: SessionId; readonly hidden: boolean },
  ): Promise<ThreadHiding>;
  leadInquiries(
    principal: Principal,
    partition: Partition,
  ): Promise<LeadInquiriesRead>;
  leadInquiry(
    principal: Principal,
    partition: Partition,
    session: SessionId,
  ): Promise<LeadInquiryRead>;
  askLead(
    principal: Principal,
    partition: Partition,
    input: {
      readonly session: SessionId;
      readonly turn: SessionTurnId;
      readonly question: string;
    },
  ): Promise<LeadInquiryAsked>;
}

export interface NativeLeadPorts {
  readonly leads: LeadReadStore;
  readonly store: SessionStoreReadPort;
}

function composedLeadPorts(ports?: NativeLeadPorts): NativeLeadPorts {
  if (ports === undefined)
    throw new Error("native web: no lead read ports were composed");
  return ports;
}

/** The stream a transcript read defaults to, which is the session's own agent reference. */
function nativeSessionStream(
  subject: SessionTranscriptSubject,
): SessionStoreStream | undefined {
  const reference = subject.agentReference;
  return reference !== undefined && isSessionStoreStream(reference)
    ? asSessionStoreStream(reference)
    : undefined;
}

/**
 * What the whole stream says the session holds, or `Undecided` where the walk
 * could not reach the stream's end. An outage on a batch outside the page is one
 * of those: the page's own batches drew, so the page is answered, and only what
 * the walk was for goes unanswered.
 */
async function nativeSessionHeldWalk(
  rows: SessionStoreRowsRead,
  store: SessionStoreReadPort,
  partition: Partition,
  subject: SessionTranscriptSubject,
  stream: SessionStoreStream,
): Promise<SessionHeldWalk | "Undecided"> {
  const texts: { readonly batch: number; readonly content: string }[] = [];
  let after = 0;
  let batchesRead = 0;
  for (;;) {
    const asks = sessionHeldWalkAsks(batchesRead);
    if (asks === 0) return "Undecided";
    const page = await rows.batches({
      partition,
      session: subject.session,
      stream,
      after,
      limit: asks,
    });
    for (const row of page) {
      const read = await store.readBatch({
        partition,
        session: subject.session,
        stream,
        batch: row.batch,
      });
      if (read.read !== "Content") return "Undecided";
      texts.push({ batch: row.batch, content: read.content });
    }
    batchesRead += page.length;
    const last = page.at(-1)?.batch;
    if (page.length < asks || last === undefined) return sessionHeldWalk(texts);
    after = last;
  }
}

/**
 * One page of a stream, drawn batch by batch. An outage on a batch of the page
 * refuses it, because that is a page nobody can answer; an outage the walk meets
 * beyond the page answers the page with no held set, and a batch that is gone or
 * fails its digest is elided and counted.
 */
async function nativeSessionTranscriptPage(
  rows: SessionStoreRowsRead,
  store: SessionStoreReadPort,
  partition: Partition,
  subject: SessionTranscriptSubject,
  query: LeadTranscriptQuery,
): Promise<LeadTranscriptRead> {
  const stream = query.stream ?? nativeSessionStream(subject);
  if (stream === undefined) return { read: "NotFound" };
  const page = await rows.batches({
    partition,
    session: subject.session,
    stream,
    after: query.after,
    limit: query.limit,
  });
  const drawn: SessionStoreRead[] = [];
  for (const row of page) {
    const read = await store.readBatch({
      partition,
      session: subject.session,
      stream,
      batch: row.batch,
    });
    if (read.read === "Unavailable") return read;
    drawn.push(read);
  }
  const held = await nativeSessionHeldWalk(
    rows,
    store,
    partition,
    subject,
    stream,
  );
  const last = page.at(-1)?.batch;
  return {
    read: "Page",
    page: leadTranscriptPage({
      stream,
      drawn,
      ...(held === "Undecided" ? {} : { walk: held }),
      ...(page.length < query.limit || last === undefined
        ? {}
        : { nextAfter: last }),
    }),
  };
}

/** The lead's own two reads, each reauthorizing before it reaches a store. */
function nativeLeadSessionMethods(
  access: ProjectAccess,
  leads?: NativeLeadPorts,
): Pick<NativeWeb, "lead" | "leadTranscript"> {
  return {
    lead: async (principal, partition) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const ports = composedLeadPorts(leads);
      const standing = await ports.leads.standing(
        partition,
        leadTurnsAnsweredMax,
      );
      if (standing === undefined) return { result: "NotFound" };
      return {
        result: "Found",
        lead: standing,
        streams: await ports.leads.streams(
          partition,
          standing.session,
          sessionStoreStreamsAnswered,
        ),
      };
    },
    leadTranscript: async (principal, partition, query) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { read: "NotFound" };
      const ports = composedLeadPorts(leads);
      const standing = await ports.leads.standing(
        partition,
        leadTurnsAnsweredMax,
      );
      if (standing === undefined) return { read: "NotFound" };
      return nativeSessionTranscriptPage(
        ports.leads,
        ports.store,
        partition,
        standing,
        checkedLeadTranscriptQuery(query),
      );
    },
  };
}

/**
 * The ports one project's threads are read and written through, arriving
 * together because a thread page needs all of them and a deployment that
 * composed some would answer a page that is part blank without saying which
 * part. `rows` and `store` are the lead's own two, session-keyed — a thread's
 * transcript is drawn by the SAME walk over the SAME bytes, so one transcript
 * has one page type and one wire answer — and `credentialSlot` is the
 * installation's named mount for a member's thread, configuration rather than a
 * port because what a thread speaks through is decided where a deployment is
 * described and never by a caller.
 */
export interface NativeThreadPorts {
  readonly threads: ThreadStore;
  readonly sessions: ThreadSessionMint;
  readonly seeding: ThreadSeedingRead;
  readonly rows: SessionStoreRowsRead;
  readonly store: SessionStoreReadPort;
  readonly credentialSlot: string;
}

function composedThreadPorts(ports?: NativeThreadPorts): NativeThreadPorts {
  if (ports === undefined)
    throw new Error("native web: no thread ports were composed");
  return ports;
}

/**
 * What the member's first turn carries, which is the seeding block and no later
 * turn's, or the ceiling it would not fit under. The overflow is a refusal
 * rather than a raise because it is the project's texts that are too long and
 * not the member's request: a bare `InvalidRequest` would tell them their
 * message was malformed, which is the one thing it was not.
 */
async function nativeThreadTurnInput(
  ports: NativeThreadPorts,
  partition: Partition,
  authority: Authority,
  seeded: boolean,
  message: string,
): Promise<string | { readonly charsMax: number }> {
  if (!seeded) return threadTurnInput(message);
  const seeding = await threadSeeding(ports.seeding, partition, authority);
  try {
    return threadTurnInput(message, seeding);
  } catch (failure) {
    if (failure instanceof RangeError)
      return { charsMax: threadTurnInputCharsMax };
    throw failure;
  }
}

/**
 * The `owner` one thread is named by: the authority its principal acts under,
 * and nothing where the project no longer admits them. Its absence is what
 * `threadStanding` reads as `Orphaned`.
 */
async function nativeThreadOwner(
  access: ProjectAccess,
  partition: Partition,
  record: ThreadRecord,
): Promise<string | undefined> {
  return (await access.authorize(record.principal, partition, "Read"))?.subject;
}

/** One page of threads as the wire names it, asking the authority once per distinct owner. */
async function nativeThreadEntries(
  access: ProjectAccess,
  partition: Partition,
  records: readonly ThreadRecord[],
  reader: Principal,
): Promise<readonly ThreadEntry[]> {
  const owners = await memberAuthorities(
    access,
    partition,
    records.map((record) => record.principal),
    threadsAnsweredMax,
  );
  return records.map((record) =>
    threadEntry(record, reader, owners.get(record.principal)?.subject),
  );
}

/** One page of inquiries as the wire names it, asking the authority once per distinct asker. */
async function nativeInquiryEntries(
  access: ProjectAccess,
  partition: Partition,
  records: readonly LeadInquiryRecord[],
  reader: Principal,
): Promise<readonly LeadInquiryEntry[]> {
  const askers = await memberAuthorities(
    access,
    partition,
    records.map((record) => record.principal),
    inquiriesAnsweredMax,
  );
  return records.map((record) =>
    leadInquiryEntry(record, reader, askers.get(record.principal)?.subject),
  );
}

/**
 * Opening the caller's own thread, which is `Mutate` and takes no session: a
 * member has one thread per project, the definer is idempotent on that, and the
 * roster it is opened with is the definer's own.
 */
function nativeOpenThreadMethod(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): NativeWeb["openThread"] {
  return async (principal, partition) => {
    const authority = await access.authorize(principal, partition, "Mutate");
    if (authority === undefined) return { result: "NotFound" };
    const ports = composedThreadPorts(threads);
    const texts = await ports.seeding.projectTexts(partition);
    const opened = await ports.threads.open({
      partition,
      principal,
      session: ports.sessions.session(),
      systemPrompt: threadSystemPrompt({
        partition,
        owner: authority.subject,
        ...(texts.northStar === undefined
          ? {}
          : { northStar: texts.northStar }),
        standingRules: resolvedThreadStandingRules(texts.standingRules),
      }),
      credentialSlot: ports.credentialSlot,
    });
    return {
      result: opened.opened,
      thread: threadEntry(opened.thread, principal, authority.subject),
    };
  };
}

/**
 * The message door, which is `Mutate` and reaches the caller's own mailbox
 * alone: the session the URL names is checked against the one the caller's
 * principal resolves to, so the page a member is reading and the mailbox their
 * message lands in cannot come apart.
 */
function nativeSendThreadMessageMethod(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): NativeWeb["sendThreadMessage"] {
  return async (principal, partition, input) => {
    const authority = await access.authorize(principal, partition, "Mutate");
    if (authority === undefined) return { result: "NotFound" };
    const ports = composedThreadPorts(threads);
    const message = checkedThreadMessage(input.message);
    const mine = await ports.threads.standing({
      partition,
      session: input.session,
      query: { limit: 1 },
    });
    if (mine === undefined) return { result: "NotFound" };
    if (mine.thread.principal !== principal) return { result: "NotYourThread" };
    if (mine.thread.state === "Closed") return { result: "Closed" };
    const turnInput = await nativeThreadTurnInput(
      ports,
      partition,
      authority,
      mine.thread.agentReference === undefined,
      message,
    );
    if (typeof turnInput !== "string")
      return { result: "TooLarge", charsMax: turnInput.charsMax };
    return threadMessageSent(
      await ports.threads.enqueueMessage({
        partition,
        principal,
        session: input.session,
        turn: input.turn,
        input: turnInput,
      }),
      input.session,
      input.turn,
    );
  };
}

/** Closing preserves the thread transcript and requires project mutation access. */
function nativeCloseThreadMethod(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): NativeWeb["closeThread"] {
  return async (principal, partition, session) => {
    if ((await access.authorize(principal, partition, "Mutate")) === undefined)
      return { result: "NotFound" };
    const ports = composedThreadPorts(threads);
    const closed = await ports.threads.close({ partition, session });
    if (closed.closed === "NoThread") return { result: "NotFound" };
    return {
      result: closed.closed,
      thread: threadEntry(
        closed.thread,
        principal,
        await nativeThreadOwner(access, partition, closed.thread),
      ),
    };
  };
}

/**
 * The gate rename and hide share: `Mutate`, the ports behind it, and the
 * caller's own mailbox — or the refusal that stands in for all three.
 */
async function nativeOwnedThread(
  access: ProjectAccess,
  threads: NativeThreadPorts | undefined,
  principal: Principal,
  partition: Partition,
  session: SessionId,
): Promise<
  | {
      readonly owned: true;
      readonly ports: NativeThreadPorts;
      readonly authority: Authority;
    }
  | { readonly owned: false; readonly result: "NotFound" | "NotYourThread" }
> {
  const authority = await access.authorize(principal, partition, "Mutate");
  if (authority === undefined) return { owned: false, result: "NotFound" };
  const ports = composedThreadPorts(threads);
  const mine = await ports.threads.standing({
    partition,
    session,
    query: { limit: 1 },
  });
  if (mine === undefined) return { owned: false, result: "NotFound" };
  if (mine.thread.principal !== principal)
    return { owned: false, result: "NotYourThread" };
  return { owned: true, ports, authority };
}

/**
 * Renaming and hiding are each the owner's alone, resolved against the
 * caller's own mailbox as the message door resolves it.
 */
function nativeThreadViewMethods(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): Pick<NativeWeb, "renameThread" | "hideThread"> {
  return {
    renameThread: async (principal, partition, input) => {
      const owned = await nativeOwnedThread(
        access,
        threads,
        principal,
        partition,
        input.session,
      );
      if (!owned.owned) return { result: owned.result };
      const renamed = await owned.ports.threads.rename({
        partition,
        session: input.session,
        title: input.title,
      });
      if (renamed.renamed === "NoThread") return { result: "NotFound" };
      return {
        result: renamed.renamed,
        thread: threadEntry(renamed.thread, principal, owned.authority.subject),
      };
    },
    hideThread: async (principal, partition, input) => {
      const owned = await nativeOwnedThread(
        access,
        threads,
        principal,
        partition,
        input.session,
      );
      if (!owned.owned) return { result: owned.result };
      const hidden = await owned.ports.threads.hide({
        partition,
        session: input.session,
        hidden: input.hidden,
      });
      if (hidden.hidden === "NoThread") return { result: "NotFound" };
      return {
        result: hidden.hidden,
        thread: threadEntry(hidden.thread, principal, owned.authority.subject),
      };
    },
  };
}

/**
 * The three reads every member of the project may make of every thread in it,
 * each reauthorizing before it reaches a store. A thread that is not this
 * project's own, and a session that is not a thread at all, answer alike:
 * `standing` refuses both, and neither is a fact a reader is owed.
 */
function nativeThreadReadMethods(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): Pick<NativeWeb, "threads" | "thread" | "threadTranscript"> {
  return {
    threads: async (principal, partition) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const ports = composedThreadPorts(threads);
      const found = await ports.threads.threads(
        partition,
        checkedThreadsLimit(threadsAnsweredMax),
      );
      return {
        result: "Found",
        threads: await nativeThreadEntries(access, partition, found, principal),
      };
    },
    thread: async (principal, partition, session, query) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const ports = composedThreadPorts(threads);
      const found = await ports.threads.standing({
        partition,
        session,
        query: checkedThreadMailboxQuery(query),
      });
      if (found === undefined) return { result: "NotFound" };
      return {
        result: "Found",
        thread: threadEntry(
          found.thread,
          principal,
          await nativeThreadOwner(access, partition, found.thread),
        ),
        turns: found.turns,
        ...(found.nextBefore === undefined
          ? {}
          : { nextBefore: found.nextBefore }),
        streams: found.streams,
      };
    },
    threadTranscript: async (principal, partition, session, query) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { read: "NotFound" };
      const ports = composedThreadPorts(threads);
      const found = await ports.threads.standing({
        partition,
        session,
        query: { limit: 1 },
      });
      if (found === undefined) return { read: "NotFound" };
      return nativeSessionTranscriptPage(
        ports.rows,
        ports.store,
        partition,
        found.thread,
        checkedLeadTranscriptQuery(query),
      );
    },
  };
}

/**
 * The three ways a member reaches the lead's inquiries, every one gated on
 * `Read` because an inquiry holds a strict subset of what `Read` already
 * permits — `./leadInquiry.ts`'s header carries the whole argument. THE ASKER
 * IS THE AUTHORITY'S OWN SUBJECT and comes from the authorization this door
 * already did, never from the body: a question whose asker the caller chose
 * would name whoever they liked on a document the lead reads.
 */
function nativeLeadInquiryMethods(
  access: ProjectAccess,
  inquiries?: LeadInquiryStore,
): Pick<NativeWeb, "leadInquiries" | "leadInquiry" | "askLead"> {
  const composed = (): LeadInquiryStore => {
    if (inquiries === undefined)
      throw new Error("native web: no lead inquiry port was composed");
    return inquiries;
  };
  return {
    leadInquiries: async (principal, partition) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const found = await composed().inquiries(partition, inquiriesAnsweredMax);
      return {
        result: "Found",
        inquiries: await nativeInquiryEntries(
          access,
          partition,
          found,
          principal,
        ),
      };
    },
    leadInquiry: async (principal, partition, session) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const found = await composed().inquiry(partition, session);
      if (found === undefined) return { result: "NotFound" };
      const [inquiry] = await nativeInquiryEntries(
        access,
        partition,
        [found],
        principal,
      );
      if (inquiry === undefined) return { result: "NotFound" };
      return { result: "Found", inquiry };
    },
    askLead: async (principal, partition, input) => {
      const authority = await access.authorize(principal, partition, "Read");
      if (authority === undefined) return { result: "NotFound" };
      return leadInquiryAsked(
        await composed().open({
          partition,
          principal,
          session: input.session,
          turn: input.turn,
          question: leadInquiryTurnInput({
            question: input.question,
            asker: authority.subject,
          }),
        }),
        input.session,
        input.turn,
      );
    },
  };
}

/** The thread side of the boundary, whose reads and whose five doors reach it as one. */
function nativeThreadMethods(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): Pick<
  NativeWeb,
  | "threads"
  | "thread"
  | "threadTranscript"
  | "openThread"
  | "sendThreadMessage"
  | "closeThread"
  | "renameThread"
  | "hideThread"
> {
  return {
    ...nativeThreadReadMethods(access, threads),
    ...nativeThreadViewMethods(access, threads),
    openThread: nativeOpenThreadMethod(access, threads),
    sendThreadMessage: nativeSendThreadMessageMethod(access, threads),
    closeThread: nativeCloseThreadMethod(access, threads),
  };
}

export function nativeWeb(
  access: ProjectAccess,
  inventory: ProjectInventory,
  leads: NativeLeadPorts,
  threads: NativeThreadPorts,
  inquiries: LeadInquiryStore,
): NativeWeb {
  return {
    projectInventory: (principal, after, limit) =>
      inventory.projects(principal, after, limit),
    ...nativeLeadSessionMethods(access, leads),
    ...nativeThreadMethods(access, threads),
    ...nativeLeadInquiryMethods(access, inquiries),
  };
}
