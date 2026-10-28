/**
 * A member's own chat against doubles: which question each door asks of the
 * tenant and of a project, what it answers when one is refused, and that no
 * door reaches another member's thread or a project the chat may not see.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { threadsAnsweredMax } from "../../src/contract/http.ts";
import type { SessionRunnerStanding } from "../../src/contract/rosters.ts";
import {
  asSessionId,
  asSessionTurnId,
  memberScopePartition,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import {
  memberChat,
  memberChatAccess,
  type MemberChatProjectRow,
} from "../../src/interpreter/memberChat.ts";
import type { NativeThreadPorts } from "../../src/interpreter/nativeWeb.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import {
  memberThreadSystemPrompt,
  threadSystemPromptCharsMax,
} from "../../src/interpreter/thread.ts";
import {
  asThreadOpenKey,
  type MemberThreadRecord,
  type ThreadRecord,
  type ThreadStore,
} from "../../src/interpreter/threadRead.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";
import { sessionRoutesAt } from "./sessionRoutesFixture.ts";

const tenant = asTenantId("acme");
const geoff = asPrincipal("issuer-geoff");
const dana = asPrincipal("issuer-dana");
const atlas = asProjectId("atlas");
const borealis = asProjectId("borealis");
const geoffs = memberScopePartition(tenant, geoff);
const own = asSessionId("own-geoff");
const key = asThreadOpenKey("open-key-1");
const at = asPublicInstant("2026-10-28T09:00:00Z");

function held(
  session: SessionId,
  principal: Principal,
  state: ThreadRecord["state"] = "Open",
): ThreadRecord {
  return {
    session,
    principal,
    state,
    turns: 1,
    openedAt: at,
    lastActivityAt: at,
    hidden: false,
  };
}

/** What a case decides the tenant and its projects answer. */
interface Answers {
  /** The principals the tenant lets open unscoped chat. */
  readonly granted: readonly Principal[];
  /** Each project's kinds the caller holds, `ChatMetadata` among them where the chat may see it. */
  readonly projects?: Readonly<Record<string, readonly ProjectAccessKind[]>>;
}

/** An access that answers as `answers` says and records every question. */
function accessOf(answers: Answers, asked: string[]): ProjectAccess {
  return {
    authorize: (principal, partition, kind) => {
      asked.push(`${partition.project}:${kind}`);
      return Promise.resolve(
        answers.projects?.[partition.project]?.includes(kind) === true
          ? memberAuthority(principal)
          : undefined,
      );
    },
    authorizeTenant: (principal, asking, kind) => {
      asked.push(`${asking}:${kind}`);
      return Promise.resolve(
        kind === "OpenUnscopedChat" && answers.granted.includes(principal)
          ? memberAuthority(principal)
          : undefined,
      );
    },
    authorizeSite: projectAccessSiteRefused,
  };
}

/** The threads a case's store holds, each where it is kept. */
interface Kept {
  readonly partition: Partition;
  readonly record: ThreadRecord;
}

/** The door a member's own thread is opened through, recording what it was opened with. */
function portsOfOpenUnscoped(calls: string[]): ThreadStore["openUnscoped"] {
  return (input) => {
    calls.push(
      `openUnscoped:${input.partition.project}:${input.session}:${input.key}:${input.credentialSlot}`,
      `prompt:${input.systemPrompt}`,
    );
    return Promise.resolve({
      opened: "Opened",
      thread: held(input.session, input.principal),
    });
  };
}

/** A member's threads across the tenant, each `kept` one theirs, scoped by where it is kept. */
function portsOfMemberThreads(
  kept: readonly Kept[],
  calls: string[],
): ThreadStore["memberThreads"] {
  return ({ principal, limit }) => {
    calls.push(`memberThreads:${principal}:${String(limit)}`);
    return Promise.resolve(
      kept
        .filter((each) => each.record.principal === principal)
        .map((each): MemberThreadRecord => ({
          ...each.record,
          project: each.partition.project,
          scope: each.partition.project.startsWith("@") ? "Member" : "Project",
        })),
    );
  };
}

/** A store over `kept`, recording every call that reaches it. */
function portsOf(kept: readonly Kept[], calls: string[]): NativeThreadPorts {
  const found = (partition: Partition, session: SessionId) =>
    kept.find(
      (each) =>
        each.partition.tenant === partition.tenant &&
        each.partition.project === partition.project &&
        each.record.session === session,
    )?.record;
  const refused = (what: string) => () => {
    calls.push(what);
    return Promise.reject(new Error(`${what} is not this suite's`));
  };
  return {
    threads: {
      threads: refused("threads"),
      open: refused("open"),
      openUnscoped: portsOfOpenUnscoped(calls),
      memberThreads: portsOfMemberThreads(kept, calls),
      standing: ({ partition, session }) => {
        calls.push(`standing:${partition.project}:${session}`);
        const record = found(partition, session);
        return Promise.resolve(
          record === undefined
            ? undefined
            : { thread: record, turns: [], streams: [] },
        );
      },
      enqueueMessage: (input) => {
        calls.push(
          `enqueue:${input.partition.project}:${input.input}:${input.route}`,
        );
        return Promise.resolve({ enqueued: "Enqueued", ordinal: 1 });
      },
      stopTurn: ({ partition, session }) => {
        calls.push(`stop:${partition.project}:${session}`);
        return Promise.resolve("Stopped");
      },
      close: ({ partition, session }) => {
        calls.push(`close:${partition.project}:${session}`);
        const record = found(partition, session);
        return Promise.resolve(
          record === undefined
            ? { closed: "NoThread" }
            : { closed: "Closed", thread: { ...record, state: "Closed" } },
        );
      },
      rename: refused("rename"),
      hide: refused("hide"),
    },
    sessions: { session: () => own },
    seeding: {
      projectTexts: refused("projectTexts"),
      drafts: refused("drafts"),
      refusals: refused("refusals"),
    },
    rows: { batches: refused("rows") },
    store: { readBatch: refused("bytes") },
    credentialSlot: "member-thread",
  };
}

/** The tenant's projects, in identity order. */
const tenantProjects: readonly MemberChatProjectRow[] = [
  { project: atlas, lifecycle: "Active" },
  { project: borealis, lifecycle: "Suspended" },
  { project: asProjectId("cygnus"), lifecycle: "Active" },
];

/** A chat over the doubles, its host standing as `host` says. */
function chatOf(
  answers: Answers,
  kept: readonly Kept[],
  host: SessionRunnerStanding = "Live",
) {
  const asked: string[] = [];
  const calls: string[] = [];
  const chat = memberChat(
    accessOf(answers, asked),
    portsOf(kept, calls),
    sessionRoutesAt(
      { Thread: "InCluster" },
      { mine: "Live", inquiry: host, project: "Live" },
    ),
    {
      projects: (asking, after, limit) => {
        calls.push(`projects:${asking}:${String(after)}:${String(limit)}`);
        return Promise.resolve(
          tenantProjects
            .filter((row) => after === undefined || row.project > after)
            .slice(0, limit),
        );
      },
    },
  );
  return { chat, asked, calls };
}

const ownKept: Kept = { partition: geoffs, record: held(own, geoff) };

test("every door answers a member whose tenant took unscoped chat as one that is not there, reaching no store", async () => {
  const { chat, calls } = chatOf({ granted: [] }, [ownKept]);
  const turn = asSessionTurnId("turn-1");
  const answered = [
    await chat.threads(geoff, tenant),
    await chat.thread(geoff, tenant, own, { limit: 1 }),
    await chat.openThread(geoff, tenant, key),
    await chat.sendThreadMessage(geoff, tenant, {
      session: own,
      turn,
      message: "which projects may I see?",
    }),
    await chat.stopThreadTurn(geoff, tenant, { session: own, turn }),
    await chat.closeThread(geoff, tenant, own),
    await chat.renameThread(geoff, tenant, { session: own, title: "mine" }),
    await chat.hideThread(geoff, tenant, { session: own, hidden: true }),
    await chat.projects(geoff, tenant, { limit: 2 }),
  ];
  for (const each of answered) assert.deepEqual(each, { result: "NotFound" });
  assert.deepEqual(
    await chat.threadTranscript(geoff, tenant, own, { after: 0, limit: 1 }),
    { read: "NotFound" },
  );
  assert.deepEqual(calls, []);
});

test("a member's own partition admits its owner alone, on the tenant's grant, and no project at all", async () => {
  const asked: string[] = [];
  const access = memberChatAccess(
    accessOf({ granted: [geoff, dana], projects: { atlas: ["Read"] } }, asked),
  );
  assert.deepEqual(
    await access.authorize(geoff, geoffs, "Mutate"),
    memberAuthority(geoff),
  );
  assert.deepEqual(asked, [`${tenant}:OpenUnscopedChat`]);
  asked.length = 0;
  assert.equal(await access.authorize(dana, geoffs, "Read"), undefined);
  assert.equal(
    await access.authorize(geoff, { tenant, project: atlas }, "Read"),
    undefined,
  );
  assert.deepEqual(asked, []);
});

test("another member reaches nothing of a member's own thread, reading or writing", async () => {
  const { chat, calls } = chatOf({ granted: [geoff, dana] }, [ownKept]);
  assert.deepEqual(await chat.thread(dana, tenant, own, { limit: 1 }), {
    result: "NotFound",
  });
  assert.deepEqual(await chat.closeThread(dana, tenant, own), {
    result: "NotFound",
  });
  const danas = memberScopePartition(tenant, dana).project;
  assert.deepEqual(calls, [
    `standing:${danas}:${own}`,
    `close:${danas}:${own}`,
  ]);
});

test("opening one opens it in the member's reserved partition under their own objectives, and is refused where no chat host of theirs would run it", async () => {
  const refused = chatOf({ granted: [geoff] }, [], "Unregistered");
  assert.deepEqual(await refused.chat.openThread(geoff, tenant, key), {
    result: "NoRunner",
  });
  assert.deepEqual(refused.calls, []);

  const { chat, calls } = chatOf({ granted: [geoff] }, [], "Offline");
  const opened = await chat.openThread(geoff, tenant, key);
  assert.equal(opened.result, "Opened");
  assert.deepEqual(calls, [
    `openUnscoped:${geoffs.project}:${own}:${key}:member-thread`,
    `prompt:${memberThreadSystemPrompt({ tenant, owner: memberAuthority(geoff).subject })}`,
  ]);
});

test("a message to the member's own thread is enqueued as typed on the runner route, and one naming an image is refused", async () => {
  const { chat, calls } = chatOf({ granted: [geoff] }, [ownKept]);
  const turn = asSessionTurnId("turn-1");
  assert.deepEqual(
    await chat.sendThreadMessage(geoff, tenant, {
      session: own,
      turn,
      message: "look at this",
      images: ["image-1"],
    }),
    { result: "ImageUnknown" },
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(
    await chat.sendThreadMessage(geoff, tenant, {
      session: own,
      turn,
      message: "which projects may I see?",
    }),
    { result: "Sent", turn, ordinal: 1 },
  );
  assert.deepEqual(calls, [
    `standing:${geoffs.project}:${own}`,
    `enqueue:${geoffs.project}:which projects may I see?:Pool`,
  ]);
});

test("the projects listed are those the chat may see, each asked in turn and its role at the strongest held, and a full page names where the next begins", async () => {
  const { chat, asked } = chatOf(
    {
      granted: [geoff],
      projects: {
        atlas: ["ChatMetadata", "Mutate", "DispatchTicket"],
        borealis: ["ChatMetadata"],
        cygnus: ["Read", "Administer"],
      },
    },
    [],
  );
  assert.deepEqual(await chat.projects(geoff, tenant, { limit: 2 }), {
    result: "Found",
    projects: [
      { project: atlas, lifecycle: "Active", role: "Developer" },
      { project: borealis, lifecycle: "Suspended", role: "Viewer" },
    ],
    nextAfter: borealis,
  });
  assert.deepEqual(
    await chat.projects(geoff, tenant, { after: borealis, limit: 2 }),
    { result: "Found", projects: [] },
  );
  assert.deepEqual(asked, [
    `${tenant}:OpenUnscopedChat`,
    "atlas:ChatMetadata",
    "atlas:Administer",
    "atlas:Mutate",
    "borealis:ChatMetadata",
    "borealis:Administer",
    "borealis:Mutate",
    "borealis:DispatchTicket",
    `${tenant}:OpenUnscopedChat`,
    "cygnus:ChatMetadata",
  ]);
  await assert.rejects(chat.projects(geoff, tenant, { limit: 0 }), RangeError);
});

test("the member's threads are listed across the tenant, their own beside each project's the chat may still see", async () => {
  const atlasThread = asSessionId("atlas-geoff");
  const borealisThread = asSessionId("borealis-geoff");
  const { chat, calls } = chatOf(
    { granted: [geoff], projects: { atlas: ["ChatMetadata"] } },
    [
      ownKept,
      {
        partition: { tenant, project: atlas },
        record: held(atlasThread, geoff),
      },
      {
        partition: { tenant, project: borealis },
        record: held(borealisThread, geoff),
      },
    ],
  );
  const listed = await chat.threads(geoff, tenant);
  assert.equal(listed.result, "Found");
  if (listed.result !== "Found") return;
  assert.deepEqual(
    listed.threads.map(({ session, scope, project, mine }) => ({
      session,
      scope,
      project,
      mine,
    })),
    [
      { session: own, scope: "Member", project: undefined, mine: true },
      { session: atlasThread, scope: "Project", project: atlas, mine: true },
    ],
  );
  assert.deepEqual(calls, [
    `memberThreads:${geoff}:${String(threadsAnsweredMax)}`,
  ]);
});

test("no door reads a project thread's turns, the member's own included, however much of the project the chat may see", async () => {
  const atlasMine = asSessionId("atlas-geoff");
  const { chat, calls } = chatOf(
    { granted: [geoff], projects: { atlas: ["ChatMetadata", "Read"] } },
    [{ partition: { tenant, project: atlas }, record: held(atlasMine, geoff) }],
  );
  assert.deepEqual(await chat.thread(geoff, tenant, atlasMine, { limit: 1 }), {
    result: "NotFound",
  });
  assert.deepEqual(
    await chat.threadTranscript(geoff, tenant, atlasMine, {
      after: 0,
      limit: 1,
    }),
    { read: "NotFound" },
  );
  assert.ok(
    calls.every((call) => !call.includes(`:${atlas}:`)),
    calls.join(" "),
  );
});

test("a member's own objectives name their tenant and them, no project, and fit every thread's ceiling", () => {
  const prompt = memberThreadSystemPrompt({ tenant, owner: "User:geoff" });
  assert.match(prompt, /User:geoff's own thread in acme/u);
  assert.match(prompt, /no project selected/u);
  assert.doesNotMatch(prompt, /North Star|standing rules/iu);
  assert.ok(prompt.length <= threadSystemPromptCharsMax);
  assert.throws(
    () => memberThreadSystemPrompt({ tenant, owner: "" }),
    /the owner is empty/u,
  );
});

test("a member opens unscoped chat exactly while their tenant lets them", async () => {
  const { chat, calls } = chatOf({ granted: [geoff] }, []);
  assert.equal(await chat.opens(geoff, tenant), true);
  assert.equal(await chat.opens(dana, tenant), false);
  assert.deepEqual(calls, []);
});
