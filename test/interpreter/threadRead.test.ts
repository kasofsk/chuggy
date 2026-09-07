/**
 * The boundary's six thread methods against doubles: which access each asks
 * for, what it answers when it is refused, what it puts in a mailbox and what
 * it closes.
 *
 * MIGRATION 062 IS NOT WRITTEN YET, so the store below is a double and every
 * claim here is about the boundary rather than about a definer. What that can
 * still settle is the whole of the authorization story — the door is the
 * caller's own, a read is every member's, and neither takes a roster, an owner
 * or a `mine` from anything a caller sent.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  threadMessageCharsMax,
  threadTitleCharsMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
} from "../../src/contract/http.ts";
import {
  asSessionId,
  asSessionTurnId,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import { nativeWeb } from "../../src/interpreter/nativeWeb.ts";
import type {
  NativeThreadPorts,
  ProjectAccess,
} from "../../src/interpreter/nativeWeb.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { asPrincipal, oidcPrincipal } from "../../src/interpreter/principal.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import { unaskedNativeWebPorts } from "./nativeWebFixtures.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  checkedThreadsLimit,
  threadBacklogRetrySeconds,
  threadEntry,
  threadTitle,
  type ThreadClosed,
  type ThreadMessageEnqueued,
  type ThreadRecord,
  type ThreadHidden,
  type ThreadRenamed,
  type ThreadStore,
} from "../../src/interpreter/threadRead.ts";
import {
  threadSystemPromptCharsMax,
  threadTurnInputCharsMax,
} from "../../src/interpreter/thread.ts";
import { threadStandingRulesDefault } from "../../src/contract/threadSeeding.ts";

const partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};
const geoff = asPrincipal("issuer\u0000geoff");
const dana = asPrincipal("issuer\u0000dana");
const authority = {
  kind: asAuthorityKind("OidcSubject"),
  subject: asAuthoritySubject("geoff"),
};
const mine = asSessionId("thread-geoff");
const hers = asSessionId("thread-dana");

/** One listing row, with every optional field settable to absent by a case. */
interface ThreadOverrides {
  readonly state?: ThreadRecord["state"];
  readonly turns?: number;
  readonly owner?: string | undefined;
  readonly agentReference?: string | undefined;
  readonly firstMessage?: string;
  readonly memberTitle?: string;
  readonly hidden?: boolean;
  readonly lastActivityAt?: string;
}

/** What a row says of itself where a case is about neither instant. */
const threadOpenedAt = asPublicInstant("2026-09-05T09:00:00Z");
const threadMovedAt = asPublicInstant("2026-09-05T10:00:00Z");

function record(
  session: SessionId,
  principal: typeof geoff,
  overrides: ThreadOverrides = {},
): ThreadRecord {
  const owner =
    "owner" in overrides
      ? overrides.owner
      : principal === geoff
        ? "geoff"
        : "dana";
  const agentReference =
    "agentReference" in overrides ? overrides.agentReference : "1a2b";
  return {
    session,
    principal,
    state: overrides.state ?? "Open",
    turns: overrides.turns ?? 2,
    ...(owner === undefined ? {} : { owner }),
    ...(agentReference === undefined ? {} : { agentReference }),
    ...(overrides.firstMessage === undefined
      ? {}
      : { firstMessage: overrides.firstMessage }),
    ...(overrides.memberTitle === undefined
      ? {}
      : { memberTitle: overrides.memberTitle }),
    openedAt: threadOpenedAt,
    lastActivityAt: asPublicInstant(overrides.lastActivityAt ?? threadMovedAt),
    hidden: overrides.hidden ?? false,
  };
}

interface ThreadDoubles {
  readonly calls: string[];
  readonly threads: readonly ThreadRecord[];
  readonly enqueued: ThreadMessageEnqueued;
  /** What the close door answers where a case sets it; else the record named, closed. */
  readonly closed?: ThreadClosed;
  /** What the rename door answers where a case sets it; else the record named. */
  readonly renamed?: ThreadRenamed;
  readonly northStar?: string;
  /** The standing rules the project holds, absent where it inherits. */
  readonly standingRules?: string;
  /** The identity the mint answers, which the definer opens the thread under. */
  readonly minted?: SessionId;
}

function threadStore(doubles: ThreadDoubles): ThreadStore {
  return {
    threads: (_partition, limit) => {
      doubles.calls.push(`threads:${String(limit)}`);
      return Promise.resolve(doubles.threads);
    },
    open: (input) => {
      doubles.calls.push(
        `open:${input.session}:${input.credentialSlot}:${input.systemPrompt}`,
      );
      return Promise.resolve({
        opened: "Opened",
        thread: record(mine, geoff, { turns: 0 }),
      });
    },
    standing: ({ session, query }) => {
      doubles.calls.push(
        `standing:${session}:${String(query.before)}:${String(query.limit)}`,
      );
      const found = doubles.threads.find((held) => held.session === session);
      return Promise.resolve(
        found === undefined
          ? undefined
          : {
              thread: found,
              turns: [],
              ...(found.turns > 1 ? { nextBefore: 1 } : {}),
              streams: [],
            },
      );
    },
    enqueueMessage: (input) => {
      doubles.calls.push(`enqueue:${input.turn}:${input.input}`);
      return Promise.resolve(doubles.enqueued);
    },
    close: ({ session }) => {
      doubles.calls.push(`close:${session}`);
      if (doubles.closed !== undefined) return Promise.resolve(doubles.closed);
      const found = doubles.threads.find((held) => held.session === session);
      return Promise.resolve(
        found === undefined
          ? { closed: "NoThread" }
          : { closed: "Closed", thread: { ...found, state: "Closed" } },
      );
    },
    rename: ({ session, title }) => {
      doubles.calls.push(`rename:${session}:${title}`);
      if (doubles.renamed !== undefined)
        return Promise.resolve(doubles.renamed);
      const found = doubles.threads.find((held) => held.session === session);
      return Promise.resolve<ThreadRenamed>(
        found === undefined
          ? { renamed: "NoThread" }
          : { renamed: "Renamed", thread: { ...found, memberTitle: title } },
      );
    },
    hide: ({ session, hidden }) => {
      doubles.calls.push(`hide:${session}:${String(hidden)}`);
      const found = doubles.threads.find((held) => held.session === session);
      return Promise.resolve<ThreadHidden>(
        found === undefined
          ? { hidden: "NoThread" }
          : {
              hidden: hidden ? "Hidden" : "Shown",
              thread: { ...found, hidden },
            },
      );
    },
  };
}

function ports(doubles: ThreadDoubles): NativeThreadPorts {
  return {
    threads: threadStore(doubles),
    sessions: { session: () => doubles.minted ?? mine },
    seeding: {
      projectTexts: () =>
        Promise.resolve({
          ...(doubles.northStar === undefined
            ? {}
            : { northStar: doubles.northStar }),
          ...(doubles.standingRules === undefined
            ? {}
            : { standingRules: doubles.standingRules }),
        }),
      drafts: () =>
        Promise.resolve([{ ticket: 42, summary: "the footer is wrong" }]),
      refusals: (_partition, tickets) => {
        doubles.calls.push(`refusals:${tickets.join(",")}`);
        return Promise.resolve([{ ticket: 42, reason: "no dependency" }]);
      },
    },
    rows: {
      batches: ({ session, stream, after, limit }) => {
        doubles.calls.push(
          `rows:${session}:${stream}:${String(after)}:${String(limit)}`,
        );
        return Promise.resolve([
          { batch: 1, digest: "a".repeat(64), bytes: 2 },
        ]);
      },
    },
    store: {
      readBatch: ({ session, batch }) => {
        doubles.calls.push(`bytes:${session}:${String(batch)}`);
        return Promise.resolve({
          read: "Content",
          content: JSON.stringify({ type: "user", uuid: "u1" }),
        });
      },
    },
    credentialSlot: "member-thread",
  };
}

function boundary(
  doubles: Partial<ThreadDoubles> = {},
  allowed: readonly ("Read" | "Mutate")[] = ["Read", "Mutate"],
) {
  const held: ThreadDoubles = {
    calls: [],
    threads: [record(mine, geoff), record(hers, dana)],
    enqueued: { enqueued: "Enqueued", session: mine, ordinal: 7 },
    ...doubles,
  };
  const access: ProjectAccess = {
    authorize: (_principal, _partition, kind) => {
      held.calls.push(`authorize:${kind}`);
      return Promise.resolve(
        (allowed as readonly string[]).includes(kind) ? authority : undefined,
      );
    },
  };
  const web = nativeWeb(
    access,
    ...unaskedNativeWebPorts,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    ports(held),
  );
  return { web, held };
}

test("every member reads every thread, and `mine` is the reader's own", async () => {
  const { web, held } = boundary();

  const read = await web.threads(dana, partition);

  assert.equal(read.result, "Found");
  assert.deepEqual(
    read.result === "Found"
      ? read.threads.map((thread) => [
          thread.session,
          thread.mine,
          thread.owner,
        ])
      : [],
    [
      [mine, false, "geoff"],
      [hers, true, "dana"],
    ],
  );
  assert.ok(held.calls.includes("authorize:Read"));
  assert.ok(held.calls.includes(`threads:${String(threadsAnsweredMax)}`));
  assert.deepEqual(
    Object.keys(read.result === "Found" ? (read.threads[0] ?? {}) : {}).sort(),
    [
      "agentReference",
      "hidden",
      "lastActivityAt",
      "mine",
      "openedAt",
      "owner",
      "session",
      "state",
      "turns",
    ],
  );
});

test("a thread listing a member may not read answers as one that is not there", async () => {
  const { web } = boundary({}, []);

  assert.equal((await web.threads(geoff, partition)).result, "NotFound");
  assert.equal(
    (await web.thread(geoff, partition, mine, { limit: 4 })).result,
    "NotFound",
  );
  assert.equal(
    (await web.threadTranscript(geoff, partition, mine, { after: 0, limit: 1 }))
      .read,
    "NotFound",
  );
});

test("a member reads another member's thread, and it is not theirs", async () => {
  const { web } = boundary();

  const read = await web.thread(dana, partition, mine, { limit: 4 });

  assert.equal(read.result, "Found");
  assert.equal(read.result === "Found" ? read.thread.mine : true, false);
  assert.equal(read.result === "Found" ? read.thread.owner : "", "geoff");
});

/**
 * READING A THREAD IS `Read` AND NOTHING MORE. A member the listing showed a
 * thread to must be able to open it, so a read narrowed to `Mutate` would hide
 * from a reader exactly what it had just told them was there.
 */
test("a member with Read alone opens a thread and its transcript", async () => {
  const one = boundary({}, ["Read"]);
  const walk = boundary({}, ["Read"]);

  const read = await one.web.thread(dana, partition, mine, { limit: 4 });
  const page = await walk.web.threadTranscript(dana, partition, mine, {
    after: 0,
    limit: 2,
  });

  assert.equal(read.result, "Found");
  assert.equal(page.read, "Page");
  assert.deepEqual(
    one.held.calls.filter((call) => call.startsWith("authorize:")),
    ["authorize:Read"],
  );
  assert.deepEqual(
    walk.held.calls.filter((call) => call.startsWith("authorize:")),
    ["authorize:Read"],
  );
});

/** A session of another project, and one that is not a thread at all, are one answer. */
test("a session this project holds no thread for is not found", async () => {
  const { web } = boundary();

  assert.equal(
    (
      await web.thread(geoff, partition, asSessionId("lead-atlas"), {
        limit: 4,
      })
    ).result,
    "NotFound",
  );
  assert.equal(
    (
      await web.threadTranscript(geoff, partition, asSessionId("lead-atlas"), {
        after: 0,
        limit: 1,
      })
    ).read,
    "NotFound",
  );
});

test("a mailbox page names the cursor that reaches the turns behind it", async () => {
  const { web, held } = boundary();

  const read = await web.thread(geoff, partition, mine, {
    before: 4,
    limit: 2,
  });

  assert.equal(read.result === "Found" ? read.nextBefore : undefined, 1);
  assert.ok(held.calls.includes(`standing:${mine}:4:2`));
});

/**
 * The listing's own bound. `nativeThreadReadMethods` hands it
 * `threadsAnsweredMax`, so the call there cannot throw and is a restatement
 * rather than a control — what makes it one is any other caller, and the
 * definer's `least(…)` is what bounds the rows either way.
 */
test("a thread listing limit outside its bounds is refused rather than clamped", () => {
  assert.equal(checkedThreadsLimit(threadsAnsweredMax), threadsAnsweredMax);
  assert.equal(checkedThreadsLimit(1), 1);
  for (const asked of [0, -1, threadsAnsweredMax + 1, 1.5, Number.NaN])
    assert.throws(() => checkedThreadsLimit(asked), RangeError, String(asked));
});

test("a mailbox page outside its bounds is refused rather than clamped", async () => {
  const { web } = boundary();

  await assert.rejects(
    web.thread(geoff, partition, mine, { limit: threadTurnsAnsweredMax + 1 }),
    RangeError,
  );
  await assert.rejects(
    web.thread(geoff, partition, mine, { limit: 0 }),
    RangeError,
  );
  await assert.rejects(
    web.thread(geoff, partition, mine, { before: 0, limit: 1 }),
    RangeError,
  );
  assert.equal(
    (
      await web.thread(geoff, partition, mine, {
        limit: threadTurnsAnsweredMax,
      })
    ).result,
    "Found",
  );
});

/**
 * The page is drawn by the lead's own walk over the thread's session: the rows
 * are asked for session-keyed, the bytes are read for that session, and the
 * default stream is the thread's own agent reference.
 */
test("a transcript page is the lead's walk over the thread's own session", async () => {
  const { web, held } = boundary();

  const read = await web.threadTranscript(dana, partition, mine, {
    after: 3,
    limit: 2,
  });

  assert.equal(read.read, "Page");
  assert.ok(held.calls.includes(`rows:${mine}:1a2b:3:2`));
  assert.ok(held.calls.includes(`bytes:${mine}:1`));
  await assert.rejects(
    web.threadTranscript(geoff, partition, mine, { after: 0, limit: 0 }),
    RangeError,
  );
  await assert.rejects(
    web.threadTranscript(geoff, partition, mine, { after: -1, limit: 1 }),
    RangeError,
  );
});

test("opening a thread is a mutation, and the roster is never the caller's", async () => {
  const { web, held } = boundary();

  const opened = await web.openThread(geoff, partition);

  assert.equal(opened.result, "Opened");
  assert.equal(opened.result === "Opened" ? opened.thread.mine : false, true);
  assert.ok(held.calls.includes("authorize:Mutate"));
  assert.ok(
    held.calls
      .find((call) => call.startsWith("open:"))
      ?.startsWith(`open:${mine}:member-thread:`),
  );
  assert.equal(
    (await boundary({}, ["Read"]).web.openThread(geoff, partition)).result,
    "NotFound",
  );
});

/**
 * Closing reaches any thread the project holds and not the caller's own alone:
 * a thread files drafts and does nothing else, so the door is `Mutate` over the
 * project rather than ownership of the thread, and the case closes another
 * member's to hold that.
 */
test("any member who may mutate closes any thread, and is answered it closed", async () => {
  const { web, held } = boundary();

  const closed = await web.closeThread(geoff, partition, hers);

  assert.deepEqual(closed, {
    result: "Closed",
    thread: {
      session: hers,
      owner: "dana",
      state: "Closed",
      mine: false,
      turns: 2,
      agentReference: "1a2b",
      openedAt: threadOpenedAt,
      lastActivityAt: threadMovedAt,
      hidden: false,
    },
  });
  assert.deepEqual(held.calls, ["authorize:Mutate", `close:${hers}`]);
});

test("a member with Read alone cannot close a thread, and no door is reached", async () => {
  const { web, held } = boundary({}, ["Read"]);

  assert.deepEqual(await web.closeThread(geoff, partition, mine), {
    result: "NotFound",
  });
  assert.deepEqual(held.calls, ["authorize:Mutate"]);
});

test("closing a thread that is already closed is answered as that, not refused", async () => {
  const { web } = boundary({
    closed: {
      closed: "AlreadyClosed",
      thread: record(mine, geoff, { state: "Closed" }),
    },
  });

  const closed = await web.closeThread(geoff, partition, mine);

  assert.equal(closed.result, "AlreadyClosed");
  assert.equal(
    closed.result === "AlreadyClosed" ? closed.thread.state : "",
    "Closed",
  );
});

test("closing a session that is no thread of this project's is not found", async () => {
  const { web, held } = boundary();

  assert.deepEqual(
    await web.closeThread(geoff, partition, asSessionId("lead-atlas")),
    { result: "NotFound" },
  );
  assert.ok(held.calls.includes("close:lead-atlas"));
});

/**
 * Renaming is gated like closing and for its reason: it changes what a rail
 * draws and nothing the thread does, so a member who may mutate the project
 * reaches any of its threads. The case renames another member's to hold that,
 * and the entry comes back titled by the name rather than by the message.
 */
test("any member who may mutate names any thread, and is answered it named", async () => {
  const { web, held } = boundary({
    threads: [
      record(mine, geoff),
      record(hers, dana, { firstMessage: "why is 42 blocked?" }),
    ],
  });

  const renamed = await web.renameThread(geoff, partition, {
    session: hers,
    title: "the footer",
  });

  assert.equal(renamed.result, "Renamed");
  assert.equal(
    renamed.result === "Renamed" ? renamed.thread.title : "",
    "the footer",
  );
  assert.deepEqual(held.calls, [
    "authorize:Mutate",
    `rename:${hers}:the footer`,
  ]);
});

test("a member with Read alone names no thread, and no door is reached", async () => {
  const { web, held } = boundary({}, ["Read"]);

  assert.deepEqual(
    await web.renameThread(geoff, partition, { session: mine, title: "x" }),
    { result: "NotFound" },
  );
  assert.deepEqual(held.calls, ["authorize:Mutate"]);
});

/**
 * Clearing the member's name leaves the title derived from the first message,
 * which is what makes a rename an override rather than a copy: a rail row that
 * went blank would have lost a name the mailbox still holds.
 */
test("clearing a member's name leaves the thread titled by its first message", async () => {
  const { web } = boundary({
    renamed: {
      renamed: "Renamed",
      thread: record(mine, geoff, { firstMessage: "why is 42 blocked?" }),
    },
  });

  const renamed = await web.renameThread(geoff, partition, {
    session: mine,
    title: "",
  });

  assert.equal(
    renamed.result === "Renamed" ? renamed.thread.title : "",
    "why is 42 blocked?",
  );
});

test("naming a session that is no thread of this project's is not found", async () => {
  const { web, held } = boundary();

  assert.deepEqual(
    await web.renameThread(geoff, partition, {
      session: asSessionId("lead-atlas"),
      title: "x",
    }),
    { result: "NotFound" },
  );
  assert.ok(held.calls.includes("rename:lead-atlas:x"));
});

/**
 * Hiding answers which side of the rail the thread is now on rather than
 * whether this press moved it, so a rail pressing Hide twice is told the thread
 * is hidden both times.
 */
test("hiding and showing a thread each answer the side it is now on", async () => {
  const { web, held } = boundary();

  const hid = await web.hideThread(geoff, partition, {
    session: mine,
    hidden: true,
  });
  const shown = await web.hideThread(geoff, partition, {
    session: mine,
    hidden: false,
  });

  assert.equal(hid.result, "Hidden");
  assert.equal(hid.result === "Hidden" ? hid.thread.hidden : false, true);
  assert.equal(shown.result, "Shown");
  assert.equal(shown.result === "Shown" ? shown.thread.hidden : true, false);
  assert.deepEqual(held.calls, [
    "authorize:Mutate",
    `hide:${mine}:true`,
    "authorize:Mutate",
    `hide:${mine}:false`,
  ]);
});

test("a member with Read alone hides no thread, and no door is reached", async () => {
  const { web, held } = boundary({}, ["Read"]);

  assert.deepEqual(
    await web.hideThread(geoff, partition, { session: mine, hidden: true }),
    { result: "NotFound" },
  );
  assert.deepEqual(held.calls, ["authorize:Mutate"]);
});

test("hiding a session that is no thread of this project's is not found", async () => {
  const { web } = boundary();

  assert.deepEqual(
    await web.hideThread(geoff, partition, {
      session: asSessionId("lead-atlas"),
      hidden: true,
    }),
    { result: "NotFound" },
  );
});

/**
 * The prompt names the membership's authority subject, which is the value an
 * operation is audited to and the value the console shows. A principal is not
 * that: `oidcPrincipal` composes `${issuer.length}:${issuer}${subject}`, so a
 * prompt built from one greets its owner as `24:https://auth.example/geoff` and
 * matches nothing they have ever seen.
 */
test("the recorded prompt names the owner and never the principal behind them", async () => {
  const { web, held } = boundary();

  await web.openThread(
    oidcPrincipal("https://auth.example", "geoff"),
    partition,
  );

  const open = held.calls.find((call) => call.startsWith("open:")) ?? "";
  assert.ok(open.includes("You are geoff's thread on acme/atlas"));
  assert.ok(!open.includes("https://auth.example"));
  assert.ok(open.includes(threadStandingRulesDefault));
});

/**
 * A project that states its own rules states them everywhere a thread reads
 * them, and the door that opens a session is the one that writes the copy a
 * resumed session holds for good.
 */
test("a project's own standing is what the opened thread's prompt carries", async () => {
  const { web, held } = boundary({
    standingRules: "- You draft, and nothing else.",
  });

  await web.openThread(
    oidcPrincipal("https://auth.example", "geoff"),
    partition,
  );

  const open = held.calls.find((call) => call.startsWith("open:")) ?? "";
  assert.ok(open.includes("- You draft, and nothing else."));
  assert.ok(!open.includes(threadStandingRulesDefault));
});

/**
 * `threadSystemPromptCharsMax` budgets three PATH SEGMENTS, one of them the
 * owner, and `authority_subject` is what the schema bounds. A principal is
 * bounded by nothing, so a prompt built from one raises on a long issuer — and
 * that member could then never open a thread at all.
 */
test("a member behind a long issuer can still open a thread", async () => {
  const { web } = boundary();

  const opened = await web.openThread(
    oidcPrincipal(`https://${"a".repeat(threadSystemPromptCharsMax)}`, "geoff"),
    partition,
  );

  assert.equal(opened.result, "Opened");
});

test("a member may not put a message in another member's thread", async () => {
  const { web, held } = boundary();

  const sent = await web.sendThreadMessage(dana, partition, {
    session: mine,
    turn: asSessionTurnId("thread-turn-1"),
    message: "have a look at 42",
  });

  assert.equal(sent.result, "NotYourThread");
  assert.equal(
    held.calls.filter((call) => call.startsWith("enqueue:")).length,
    0,
  );
});

test("a message to my own thread is enqueued and answers its ordinal", async () => {
  const { web, held } = boundary();

  const sent = await web.sendThreadMessage(geoff, partition, {
    session: mine,
    turn: asSessionTurnId("thread-turn-1"),
    message: "have a look at 42",
  });

  assert.deepEqual(sent, {
    result: "Sent",
    turn: asSessionTurnId("thread-turn-1"),
    ordinal: 7,
  });
  assert.ok(held.calls.includes("enqueue:thread-turn-1:have a look at 42"));
  assert.ok(held.calls.includes("authorize:Mutate"));
});

/**
 * The standing read and the enqueue are two round trips, and a thread can be
 * closed by the reaper and reopened from another tab between them; the enqueue
 * resolves the mailbox from the principal, so the ordinal it answers may belong
 * to a session the URL never named — a `202` about a conversation the member is
 * not reading. The URL is therefore held against what resolved.
 */
test("a mailbox reopened under the caller between the two round trips is refused", async () => {
  const { web, held } = boundary({
    enqueued: {
      enqueued: "Enqueued",
      session: asSessionId("thread-geoff-reopened"),
      ordinal: 1,
    },
  });

  const sent = await web.sendThreadMessage(geoff, partition, {
    session: mine,
    turn: asSessionTurnId("thread-turn-1"),
    message: "still 42",
  });

  assert.equal(sent.result, "NotYourThread");
  assert.equal(
    held.calls.filter((call) => call.startsWith("enqueue:")).length,
    1,
  );
});

/**
 * The durable side compares the session the URL named against the mailbox it
 * resolved and refuses a mismatch itself, so the comparison here is the second
 * of two. The door passes that refusal through rather than reading it as a
 * mailbox that has gone.
 */
test("a mailbox the durable side says is not the caller's is refused as that", async () => {
  const { web } = boundary({ enqueued: { enqueued: "NotYourThread" } });

  assert.equal(
    (
      await web.sendThreadMessage(geoff, partition, {
        session: mine,
        turn: asSessionTurnId("thread-turn-1"),
        message: "have a look at 42",
      })
    ).result,
    "NotYourThread",
  );
});

/** The same holds of a retry, whose ordinal is just as much a claim about a mailbox. */
test("a retry whose mailbox has moved is refused rather than reported", async () => {
  const { web } = boundary({
    enqueued: {
      enqueued: "AlreadyEnqueued",
      session: asSessionId("thread-geoff-reopened"),
      ordinal: 1,
    },
  });

  assert.equal(
    (
      await web.sendThreadMessage(geoff, partition, {
        session: mine,
        turn: asSessionTurnId("thread-turn-1"),
        message: "again",
      })
    ).result,
    "NotYourThread",
  );
});

/**
 * The door is `Mutate` and reading is `Read`, so a member who may read every
 * thread in the project still cannot put a message in their own.
 */
test("a member with Read alone cannot write to their own thread", async () => {
  const { web, held } = boundary({}, ["Read"]);

  const sent = await web.sendThreadMessage(geoff, partition, {
    session: mine,
    turn: asSessionTurnId("thread-turn-1"),
    message: "have a look at 42",
  });

  assert.equal(sent.result, "NotFound");
  assert.deepEqual(held.calls, ["authorize:Mutate"]);
});

/**
 * What overflows a seeded first turn is the project's own North Star, which the
 * settings route already accepted and the member cannot shorten. So the door
 * names its ceiling rather than answering that the request was invalid.
 */
test("a first turn the project's own context will not fit in names its ceiling", async () => {
  const { web, held } = boundary({
    threads: [record(mine, geoff, { agentReference: undefined })],
    northStar: "x".repeat(threadTurnInputCharsMax),
  });

  const sent = await web.sendThreadMessage(geoff, partition, {
    session: mine,
    turn: asSessionTurnId("thread-turn-1"),
    message: "what is blocking 42?",
  });

  assert.deepEqual(sent, {
    result: "TooLarge",
    charsMax: threadTurnInputCharsMax,
  });
  assert.equal(
    held.calls.filter((call) => call.startsWith("enqueue:")).length,
    0,
  );
});

test("a retried message answers the ordinal it already has", async () => {
  const { web } = boundary({
    enqueued: { enqueued: "AlreadyEnqueued", session: mine, ordinal: 7 },
  });

  const sent = await web.sendThreadMessage(geoff, partition, {
    session: mine,
    turn: asSessionTurnId("thread-turn-1"),
    message: "again",
  });

  assert.equal(sent.result, "AlreadySent");
  assert.equal(sent.result === "AlreadySent" ? sent.ordinal : 0, 7);
});

test("a message outside the door's bound is refused before a mailbox is reached", async () => {
  const { web, held } = boundary();

  await assert.rejects(
    web.sendThreadMessage(geoff, partition, {
      session: mine,
      turn: asSessionTurnId("thread-turn-1"),
      message: "x".repeat(threadMessageCharsMax + 1),
    }),
    RangeError,
  );
  await assert.rejects(
    web.sendThreadMessage(geoff, partition, {
      session: mine,
      turn: asSessionTurnId("thread-turn-1"),
      message: "",
    }),
    RangeError,
  );
  assert.equal(
    held.calls.filter((call) => call.startsWith("enqueue:")).length,
    0,
  );
});

test("the door's bound counts code points, matching the schema in front of it", async () => {
  const { web, held } = boundary();
  const atBound = "😀".repeat(threadMessageCharsMax);

  const sent = await web.sendThreadMessage(geoff, partition, {
    session: mine,
    turn: asSessionTurnId("thread-turn-1"),
    message: atBound,
  });

  assert.equal(sent.result, "Sent");
  assert.equal(
    held.calls.filter((call) => call.startsWith("enqueue:")).length,
    1,
  );
  await assert.rejects(
    web.sendThreadMessage(geoff, partition, {
      session: mine,
      turn: asSessionTurnId("thread-turn-1"),
      message: atBound + "😀",
    }),
    new RegExp(`at most ${String(threadMessageCharsMax)} characters`, "u"),
  );
});

test("a closed thread and an ownerless one each refuse the message they cannot take", async () => {
  const closed = boundary({
    threads: [record(mine, geoff, { state: "Closed" })],
  });
  const orphaned = boundary({
    threads: [record(mine, geoff, { owner: undefined })],
  });
  const message = {
    session: mine,
    turn: asSessionTurnId("thread-turn-1"),
    message: "anyone there?",
  };

  assert.equal(
    (await closed.web.sendThreadMessage(geoff, partition, message)).result,
    "Closed",
  );
  assert.equal(
    (await orphaned.web.sendThreadMessage(geoff, partition, message)).result,
    "Orphaned",
  );
  for (const held of [closed.held, orphaned.held])
    assert.equal(
      held.calls.filter((call) => call.startsWith("enqueue:")).length,
      0,
    );
});

test("a backlogged thread is told when to come back rather than told nothing", async () => {
  const { web } = boundary({ enqueued: { enqueued: "Backlogged" } });

  assert.deepEqual(
    await web.sendThreadMessage(geoff, partition, {
      session: mine,
      turn: asSessionTurnId("thread-turn-1"),
      message: "one more",
    }),
    { result: "Backlogged", retryAfterSeconds: threadBacklogRetrySeconds },
  );
});

/**
 * The mailbox the durable side resolved is the mailbox the message lands in, so
 * a thread that has gone between the read and the write is a refusal rather
 * than a message in a mailbox nobody is reading.
 */
test("a mailbox that vanished between the read and the write is not found", async () => {
  const { web } = boundary({ enqueued: { enqueued: "NoThread" } });

  assert.equal(
    (
      await web.sendThreadMessage(geoff, partition, {
        session: mine,
        turn: asSessionTurnId("thread-turn-1"),
        message: "still there?",
      })
    ).result,
    "NotFound",
  );
});

test("the first turn is seeded and every later turn is the message alone", async () => {
  const seeded = boundary({
    threads: [record(mine, geoff, { agentReference: undefined })],
    northStar: "Ship the console.",
  });
  const bound = boundary({ northStar: "Ship the console." });
  const message = {
    session: mine,
    turn: asSessionTurnId("thread-turn-1"),
    message: "what is blocking 42?",
  };

  await seeded.web.sendThreadMessage(geoff, partition, message);
  await bound.web.sendThreadMessage(geoff, partition, message);

  const first = seeded.held.calls.find((call) => call.startsWith("enqueue:"));
  assert.ok(first?.includes("Ship the console."));
  assert.ok(first?.includes(threadStandingRulesDefault));
  assert.ok(first?.includes("the footer is wrong"));
  assert.ok(first?.includes("no dependency"));
  assert.ok(first?.endsWith("what is blocking 42?"));
  assert.ok(seeded.held.calls.includes("refusals:42"));
  assert.deepEqual(
    bound.held.calls.filter((call) => call.startsWith("enqueue:")),
    ["enqueue:thread-turn-1:what is blocking 42?"],
  );
  assert.equal(
    bound.held.calls.filter((call) => call.startsWith("refusals:")).length,
    0,
  );
});

test("a project's own standing is what the seeded first turn carries", async () => {
  const { web, held } = boundary({
    threads: [record(mine, geoff, { agentReference: undefined })],
    standingRules: "- You draft, and nothing else.",
  });

  await web.sendThreadMessage(geoff, partition, {
    session: mine,
    turn: asSessionTurnId("thread-turn-1"),
    message: "what is blocking 42?",
  });

  const first = held.calls.find((call) => call.startsWith("enqueue:")) ?? "";
  assert.ok(first.includes("- You draft, and nothing else."));
  assert.ok(!first.includes(threadStandingRulesDefault));
});

test("a title is the first non-empty line of the first message, run onto one line", () => {
  assert.equal(
    threadTitle({ firstMessage: "why is 42 blocked?" }),
    "why is 42 blocked?",
  );
  assert.equal(
    threadTitle({ firstMessage: "\n\n   \nwhy is 42 blocked?\nand 43?" }),
    "why is 42 blocked?",
  );
  assert.equal(
    threadTitle({ firstMessage: "  why   is\t42\u00a0blocked?  " }),
    "why is 42 blocked?",
  );
});

test("a message with nothing but whitespace in it names no thread", () => {
  assert.equal(threadTitle({ firstMessage: "" }), undefined);
  assert.equal(threadTitle({ firstMessage: "\n \t\n" }), undefined);
});

test("a title is cut to its bound in code points, not in UTF-16 units", () => {
  const said = "\u{1f600}".repeat(threadTitleCharsMax * 2);
  const title = threadTitle({ firstMessage: said }) ?? "";
  assert.equal([...title].length, threadTitleCharsMax);
  assert.equal(title, "\u{1f600}".repeat(threadTitleCharsMax));
});

test("a cut that lands on a space does not leave one at the end", () => {
  const said = `${"a".repeat(threadTitleCharsMax - 1)} bcd`;
  assert.equal(
    threadTitle({ firstMessage: said }),
    "a".repeat(threadTitleCharsMax - 1),
  );
});

test("a member's own name for a thread is its title, and clearing it leaves the derived one", () => {
  assert.equal(
    threadTitle({
      memberTitle: "the footer",
      firstMessage: "why is 42 blocked?",
    }),
    "the footer",
  );
  assert.equal(
    threadTitle({ firstMessage: "why is 42 blocked?" }),
    "why is 42 blocked?",
  );
});

test("an entry is titled by its first message and untitled without one", () => {
  assert.equal(
    threadEntry(
      { ...record(mine, geoff), firstMessage: "why is 42 blocked?\nand 43?" },
      geoff,
    ).title,
    "why is 42 blocked?",
  );
  assert.equal(threadEntry(record(mine, geoff), geoff).title, undefined);
});
