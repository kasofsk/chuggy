/**
 * A draft a creation's submit left held, and each way the submit after it
 * ends.
 *
 * Every case drives one submit after another over a door that holds the
 * draft's version fence and decides its releases, and compares what a submit
 * sent, the whole of what it said, and what it left held for the next.
 */

import { expect, test } from "vitest";

import { nativeHttpBasePath } from "../../../src/contract/http.ts";
import { creationStageOf } from "../app/core/ticketCreation.ts";
import { createAndReleaseTicket } from "../app/core/ticketCreationRun.ts";
import type {
  CreationDraftHeld,
  TicketCreationEnded,
  TicketCreationRequest,
} from "../app/core/ticketCreationRun.ts";
import { answeringApi } from "./answeringApi.ts";
import type { Answer, Sent } from "./answeringApi.ts";
import {
  creationInitialization,
  creationPartition,
} from "./ticketCreationFixture.ts";
import {
  ticketDoor,
  ticketDoorAnswers,
  ticketDoorDecides,
  ticketRefusedFirst,
} from "./ticketReleasing.tsx";
import type { TicketDoor } from "./ticketReleasing.tsx";

type Body = TicketCreationRequest["body"];

const partitionBase = `${nativeHttpBasePath}/tenants/acme/projects/atlas`;

const first: Body = {
  configurationRevision: "r3",
  configurationDigest: creationInitialization.fence.configurationDigest,
  expectedProjectSequence: 41,
  authoring: creationInitialization.defaults,
  brief: { intent: "ship it", links: [] },
};

function saying(intent: string): Body {
  return { ...first, brief: { intent, links: [] } };
}

const changed = saying("ship that");

/**
 * One request as a case compares it: a revision by the version it was fenced
 * at and the intent it wrote, a release by its identity and the version it
 * named.
 */
function line(one: Sent): string {
  const said = `${one.method} ${one.path.slice(partitionBase.length)}`;
  if (one.method === "PUT") {
    const revision = one.body as {
      readonly expectedVersion: number;
      readonly brief: { readonly intent: string };
    };
    return `${said} at ${String(revision.expectedVersion)} saying ${revision.brief.intent}`;
  }
  if (one.method !== "POST" || !one.path.endsWith("/operations")) return said;
  const release = one.body as {
    readonly operation: string;
    readonly mutation: { readonly authoringVersion: number };
  };
  return `${said} ${release.operation} at ${String(release.mutation.authoringVersion)}`;
}

/** A run of the same request is one line: a poll repeats until it is answered. */
function lines(sent: readonly Sent[]): readonly string[] {
  return sent.map(line).filter((said, at, all) => said !== all[at - 1]);
}

/** What a submit left held, by what the next one reads of it. */
function heldSaid(held: CreationDraftHeld | undefined): unknown {
  if (held === undefined) return undefined;
  return {
    version: held.draft.authoringVersion,
    intent: held.body?.brief?.intent,
    operation: held.operation,
    unsettled: held.unsettled,
  };
}

function endedSaid(ended: TicketCreationEnded): string {
  switch (ended.created) {
    case "Created":
    case "Exists":
      return `${ended.created} ${String(ended.ticket)}`;
    case "Stale":
    case "Refused":
      return ended.reason;
  }
}

interface Submitted {
  readonly sent: readonly string[];
  readonly said: string;
  readonly held: unknown;
}

/**
 * One form's submits over one door, each holding what the one before it
 * handed back and drawing the next operation in turn.
 */
function creation(
  decide: (nth: number) => string,
  over?: (method: string, path: string, answered: () => Answer) => Answer,
): {
  readonly door: TicketDoor;
  readonly submit: (body?: Body) => Promise<Submitted>;
} {
  const door = ticketDoor();
  const api = answeringApi(ticketDoorAnswers(door, decide, over));
  const form: { held: CreationDraftHeld | undefined; drawn: number } = {
    held: undefined,
    drawn: 0,
  };
  return {
    door,
    submit: async (body = first) => {
      form.drawn += 1;
      const from = api.sent.length;
      const ended = await createAndReleaseTicket(
        api.ports,
        creationPartition,
        { body, operation: `op-${String(form.drawn)}`, held: form.held },
        () => undefined,
      );
      form.held = "held" in ended ? ended.held : undefined;
      return {
        sent: lines(api.sent.slice(from)),
        said: endedSaid(ended),
        held: heldSaid(form.held),
      };
    },
  };
}

const unreleased =
  "draft 12 was created and not released; submitting again goes back to that draft rather than creating another";
const unknown =
  "draft 12 was created, and whether it was released is not known; submitting again goes back to that draft rather than creating another";
const invalid =
  "the configuration this named is not one the project will run, or it hands the work off where this brief opens a pull request";
const pending = "the operation is still pending after the attempt budget";
const fencedOut = "the ticket's authoring changed after this was submitted";

const draftRead = "GET /drafts/12";
const confirmed = "GET ?after=11&limit=1&minimumSequence=42";

/** A release sent under an identity, polled, and its ticket then confirmed. */
function released(operation: string, version: number): readonly string[] {
  return [
    `POST /operations ${operation} at ${String(version)}`,
    `GET /operations/${operation}`,
    confirmed,
  ];
}

const failed: Answer = {
  status: 500,
  body: { error: { code: "InternalError" } },
};

test("a release the actor refuses holds its draft, known unreleased, beside what wrote it", async () => {
  const form = creation(ticketRefusedFirst);
  expect(await form.submit()).toStrictEqual({
    sent: [
      "POST /drafts",
      "POST /operations op-1 at 3",
      "GET /operations/op-1",
    ],
    said: `${invalid} — ${unreleased}`,
    held: {
      version: 3,
      intent: "ship it",
      operation: "op-1",
      unsettled: false,
    },
  });
});

/**
 * The fence is the creation's alone: a revision carries none, so a form read
 * again under a project that moved still says what its draft holds.
 */
test.each([
  ["the body it was written from", first],
  [
    "that body under a fence that moved",
    {
      ...first,
      configurationDigest: "c".repeat(64),
      expectedProjectSequence: 99,
    },
  ],
])(
  "a held draft is released again as it stands under %s, by the operation it went under and unread",
  async (_said, body) => {
    const form = creation(ticketRefusedFirst);
    const refused = await form.submit();
    expect(await form.submit(body)).toStrictEqual({
      ...refused,
      sent: ["POST /operations op-1 at 3", "GET /operations/op-1"],
    });
  },
);

/** Each part of what a revision writes, moved alone. */
const moved: readonly (readonly [string, Body])[] = [
  ["another configuration", { ...first, configurationRevision: "r4" }],
  ["another intent", changed],
  ["an image", { ...first, brief: { ...first.brief, images: ["artifact-1"] } }],
  [
    "an override",
    { ...first, overrides: { worker: { setup: ["npm ci --omit=dev"] } } },
  ],
  [
    "another program",
    {
      ...first,
      authoring: { dependencies: [], program: [creationStageOf(2, 1)] },
    },
  ],
];

test.each(moved)(
  "a held draft is read, revised to a form naming %s at the version read, and released under a fresh operation",
  async (_said, body) => {
    const door = ticketDoor();
    const api = answeringApi(ticketDoorAnswers(door, ticketRefusedFirst));
    const refused = await createAndReleaseTicket(
      api.ports,
      creationPartition,
      { body: first, operation: "op-1" },
      () => undefined,
    );
    const from = api.sent.length;
    const created = await createAndReleaseTicket(
      api.ports,
      creationPartition,
      {
        body,
        operation: "op-2",
        held: "held" in refused ? refused.held : undefined,
      },
      () => undefined,
    );
    expect(created).toStrictEqual({ created: "Created", ticket: 12 });
    expect(
      api.sent.slice(from, from + 3).map((one) => [one.method, one.body]),
    ).toStrictEqual([
      ["GET", undefined],
      [
        "PUT",
        {
          expectedVersion: 3,
          configurationRevision: body.configurationRevision,
          authoring: body.authoring,
          brief: body.brief,
          ...(body.overrides === undefined
            ? {}
            : { overrides: body.overrides }),
        },
      ],
      [
        "POST",
        {
          operation: "op-2",
          mutation: {
            mutation: "ReleaseDraft",
            ticket: 12,
            authoringVersion: 4,
            configurationRevision: body.configurationRevision,
          },
        },
      ],
    ]);
  },
);

test("a revision whose release is refused is the draft held next, and the same form releases it again unread", async () => {
  const form = creation((nth) =>
    nth < 3 ? "ConfigurationInvalid" : "Succeeded",
  );
  await form.submit();
  const revised = await form.submit(changed);
  expect(revised).toStrictEqual({
    sent: [
      draftRead,
      "PUT /drafts/12 at 3 saying ship that",
      "POST /operations op-2 at 4",
      "GET /operations/op-2",
    ],
    said: `${invalid} — ${unreleased}`,
    held: {
      version: 4,
      intent: "ship that",
      operation: "op-2",
      unsettled: false,
    },
  });
  expect(await form.submit(changed)).toStrictEqual({
    ...revised,
    sent: ["POST /operations op-2 at 4", "GET /operations/op-2"],
  });
});

/** A release left pending past the console's budget, which the actor carries
 * out once nobody is asking. */
async function neverLearned(
  form: ReturnType<typeof creation>,
): Promise<Submitted> {
  const abandoned = await form.submit();
  ticketDoorDecides(form.door, form.door.releases[0], "Succeeded");
  return abandoned;
}

const exists: Submitted = {
  sent: [draftRead],
  said: "Exists 12",
  held: { version: 3, intent: "ship it", operation: "op-1", unsettled: true },
};

test("a release nobody saw settle is held as one that may have gone through", async () => {
  const form = creation(() => "Pending");
  expect(await form.submit()).toStrictEqual({
    sent: [
      "POST /drafts",
      "POST /operations op-1 at 3",
      "GET /operations/op-1",
    ],
    said: `${pending} — ${unknown}`,
    held: exists.held,
  });
});

test("a changed form over a release that had gone through writes nothing and ends at the ticket, however often", async () => {
  const form = creation(() => "Pending");
  await neverLearned(form);
  expect(await form.submit(changed)).toStrictEqual(exists);
  expect(await form.submit(saying("ship the other"))).toStrictEqual(exists);
  expect(form.door.version).toBe(3);
});

test("a form put back as its released draft was written is that release asked about again", async () => {
  const form = creation(() => "Pending");
  await neverLearned(form);
  await form.submit(changed);
  expect(await form.submit()).toStrictEqual({
    sent: released("op-1", 3),
    said: "Created 12",
    held: undefined,
  });
});

test("a changed form over a ticket already past Pending is not sent to a door that would refuse it", async () => {
  const form = creation(() => "Pending");
  await neverLearned(form);
  form.door.closed = true;
  expect(await form.submit(changed)).toStrictEqual(exists);
  expect((await form.submit()).said).toBe("Created 12");
});

/** The door applies the first revision it is sent and answers it as a fault. */
function answerLost(): ReturnType<typeof creation> {
  const lost = { count: 0 };
  return creation(ticketRefusedFirst, (method, _path, answered) => {
    const answer = answered();
    if (method !== "PUT") return answer;
    lost.count += 1;
    return lost.count === 1 ? failed : answer;
  });
}

const revisionLost: Submitted = {
  sent: [draftRead, "PUT /drafts/12 at 3 saying ship that"],
  said: `the API refused this, and named a reason this console does not know (InternalError) — ${unreleased}`,
  held: { version: 3, intent: "ship it", operation: "op-1", unsettled: false },
};

test.each([
  ["the same form again", changed],
  ["a form changed again", saying("ship the other")],
])(
  "a revision the door applied and answered as a fault is written over by %s, at the version the door is at",
  async (_said, body) => {
    const form = answerLost();
    await form.submit();
    expect(await form.submit(changed)).toStrictEqual(revisionLost);
    expect(form.door.version).toBe(4);
    expect(await form.submit(body)).toStrictEqual({
      sent: [
        draftRead,
        `PUT /drafts/12 at 4 saying ${String(body.brief?.intent)}`,
        ...released("op-3", 5),
      ],
      said: "Created 12",
      held: undefined,
    });
  },
);

test("a held draft that cannot be read is written nothing, and is read again by the next submit", async () => {
  const reads = { failing: true };
  const form = creation(ticketRefusedFirst, (method, path, answered) =>
    reads.failing && method === "GET" && path.endsWith("/drafts/12")
      ? failed
      : answered(),
  );
  const refused = await form.submit();
  expect(await form.submit(changed)).toStrictEqual({
    sent: [draftRead],
    said: `the draft could not be read, so nothing was written to it: the API failed with InternalError — ${unreleased}`,
    held: refused.held,
  });
  reads.failing = false;
  expect(await form.submit(changed)).toStrictEqual({
    sent: [
      draftRead,
      "PUT /drafts/12 at 3 saying ship that",
      ...released("op-3", 4),
    ],
    said: "Created 12",
    held: undefined,
  });
});

test("a draft another writer revised between its read and its revision is said, and written over at the next submit", async () => {
  const raced = { count: 0 };
  const form = creation(ticketRefusedFirst, (method, _path, answered) => {
    if (method === "PUT" && raced.count === 0) form.door.version += 1;
    if (method === "PUT") raced.count += 1;
    return answered();
  });
  const refused = await form.submit();
  expect(await form.submit(changed)).toStrictEqual({
    sent: [draftRead, "PUT /drafts/12 at 3 saying ship that"],
    said: `the draft was revised somewhere else while this was being written to it, so this was not written — ${unreleased}`,
    held: refused.held,
  });
  expect(await form.submit(changed)).toStrictEqual({
    sent: [
      draftRead,
      "PUT /drafts/12 at 4 saying ship that",
      ...released("op-3", 5),
    ],
    said: "Created 12",
    held: undefined,
  });
});

test("a draft its door closes between its read and its revision may have been released, and the next submit finds out", async () => {
  const form = creation(ticketRefusedFirst, (method, _path, answered) => {
    if (method === "PUT") {
      form.door.state = "Released";
      form.door.closed = true;
    }
    return answered();
  });
  await form.submit();
  expect(await form.submit(changed)).toStrictEqual({
    sent: [draftRead, "PUT /drafts/12 at 3 saying ship that"],
    said: `the draft is closed to revision: only a pending ticket's draft can be revised — ${unknown}`,
    held: { version: 3, intent: "ship it", operation: "op-1", unsettled: true },
  });
  expect(await form.submit(changed)).toStrictEqual(exists);
});

test("a held draft read as deleted is let go of, and the next submit creates another", async () => {
  const form = creation(ticketRefusedFirst);
  await form.submit();
  form.door.state = "Deleted";
  expect(await form.submit(changed)).toStrictEqual({
    sent: [draftRead],
    said: "draft 12 was deleted, so there is nothing of it left to release; submitting again creates another",
    held: undefined,
  });
  expect((await form.submit(changed)).sent[0]).toBe("POST /drafts");
});

/**
 * The first release is carried out between the read of its draft and the
 * revision of it, which the door takes while the ticket is Pending. The fresh
 * release is then refused by the fence, and the draft is read to say why.
 */
test("a fresh release fenced out by one that went through in between ends at the ticket", async () => {
  const form = creation(
    (nth) => (nth === 1 ? "Pending" : "Succeeded"),
    (method, _path, answered) => {
      if (method === "PUT")
        ticketDoorDecides(form.door, form.door.releases[0], "Succeeded");
      return answered();
    },
  );
  await form.submit();
  const ended = {
    said: "Exists 12",
    held: {
      version: 4,
      intent: "ship that",
      operation: "op-2",
      unsettled: true,
    },
  };
  expect(await form.submit(changed)).toStrictEqual({
    ...ended,
    sent: [
      draftRead,
      "PUT /drafts/12 at 3 saying ship that",
      "POST /operations op-2 at 4",
      "GET /operations/op-2",
      draftRead,
    ],
  });
  expect(await form.submit(changed)).toStrictEqual({
    ...ended,
    sent: ["POST /operations op-2 at 4", "GET /operations/op-2", draftRead],
  });
});

/** Another writer revises the draft before its first release is decided. */
function writtenOver(
  over?: Parameters<typeof creation>[1],
): ReturnType<typeof creation> {
  const form = creation((nth) => {
    if (nth === 1) form.door.version += 1;
    return "Succeeded";
  }, over);
  return form;
}

test("a release fenced out of a draft still unreleased holds it as no longer this form's, so the same form is written over it", async () => {
  const form = writtenOver();
  expect(await form.submit()).toStrictEqual({
    sent: [
      "POST /drafts",
      "POST /operations op-1 at 3",
      "GET /operations/op-1",
      draftRead,
    ],
    said: `${fencedOut} — ${unreleased}`,
    held: {
      version: 3,
      intent: undefined,
      operation: "op-1",
      unsettled: false,
    },
  });
  expect(await form.submit()).toStrictEqual({
    sent: [
      draftRead,
      "PUT /drafts/12 at 4 saying ship it",
      ...released("op-2", 5),
    ],
    said: "Created 12",
    held: undefined,
  });
});

test("a release fenced out of a draft that cannot then be read is asked about again, and the draft read again", async () => {
  const reads = { failing: true };
  const form = writtenOver((method, path, answered) =>
    reads.failing && method === "GET" && path.endsWith("/drafts/12")
      ? failed
      : answered(),
  );
  const unread = await form.submit();
  expect(unread).toStrictEqual({
    sent: [
      "POST /drafts",
      "POST /operations op-1 at 3",
      "GET /operations/op-1",
      draftRead,
    ],
    said: `${fencedOut} — ${unknown}`,
    held: { version: 3, intent: "ship it", operation: "op-1", unsettled: true },
  });
  reads.failing = false;
  expect(await form.submit()).toStrictEqual({
    sent: ["POST /operations op-1 at 3", "GET /operations/op-1", draftRead],
    said: `${fencedOut} — ${unreleased}`,
    held: {
      version: 3,
      intent: undefined,
      operation: "op-1",
      unsettled: false,
    },
  });
});

test("a release fenced out of a draft since deleted says so, and holds nothing", async () => {
  const form = creation((nth) => {
    if (nth === 1) form.door.state = "Deleted";
    return "Succeeded";
  });
  expect(await form.submit()).toStrictEqual({
    sent: [
      "POST /drafts",
      "POST /operations op-1 at 3",
      "GET /operations/op-1",
      draftRead,
    ],
    said: "draft 12 was deleted, so there is nothing of it left to release; submitting again creates another",
    held: undefined,
  });
});

const declined: Answer = {
  status: 409,
  body: { error: { code: "MutationNotAdmitted" } },
};
const notAdmitted =
  "the project is not admitting this kind of mutation at the moment";

/** One release's ending, by what answers its submission and its polls. */
const endings: readonly (readonly [
  string,
  string,
  (method: string, path: string) => Answer | undefined,
  string,
  boolean,
])[] = [
  [
    "the API declines before accepting",
    "Pending",
    (method, path) =>
      method === "POST" && path.endsWith("/operations") ? declined : undefined,
    notAdmitted,
    false,
  ],
  [
    "the API answers with a fault",
    "Pending",
    (method, path) =>
      method === "POST" && path.endsWith("/operations") ? failed : undefined,
    "the API refused this, and named a reason this console does not know (InternalError)",
    true,
  ],
  [
    "the API accepts and then declines to be asked about",
    "Pending",
    (_method, path) => (path.includes("/operations/") ? declined : undefined),
    notAdmitted,
    true,
  ],
  [
    "the actor refuses",
    "ConfigurationInvalid",
    () => undefined,
    invalid,
    false,
  ],
  [
    "the operation is cancelled undecided",
    "Cancelled",
    () => undefined,
    "the operation was cancelled before it was decided",
    false,
  ],
];

test.each(endings)(
  "a first release that %s leaves its draft said as it then stands",
  async (_said, verdict, answer, reason, unsettled) => {
    const form = creation(
      () => verdict,
      (method, path, answered) => answer(method, path) ?? answered(),
    );
    const ended = await form.submit();
    expect(ended.said).toBe(`${reason} — ${unsettled ? unknown : unreleased}`);
    expect(ended.held).toStrictEqual({
      version: 3,
      intent: "ship it",
      operation: "op-1",
      unsettled,
    });
  },
);

/**
 * The same endings of a second release, of a draft revised after a first.
 * After one the actor refused the draft stands as each ending alone leaves
 * it; after one nobody saw settle, only a refusal the actor settles says the
 * draft is still unreleased.
 */
test.each(
  (["ConfigurationInvalid", "Pending"] as const).flatMap((before) =>
    endings.map(
      ([said, verdict, answer, reason, unsettled]) =>
        [
          before === "Pending" ? "nobody saw settle" : "the actor refused",
          said,
          before,
          verdict,
          answer,
          reason,
          unsettled ||
            (before === "Pending" && verdict !== "ConfigurationInvalid"),
        ] as const,
    ),
  ),
)(
  "after a release %s, one that %s leaves its draft said as it then stands",
  async (_was, _said, before, verdict, answer, reason, unsettled) => {
    const second = { on: false };
    const form = creation(
      (nth) => (nth === 1 ? before : verdict),
      (method, path, answered) =>
        (second.on ? answer(method, path) : undefined) ?? answered(),
    );
    await form.submit();
    second.on = true;
    const ended = await form.submit(changed);
    expect(ended.said).toBe(`${reason} — ${unsettled ? unknown : unreleased}`);
    expect(ended.held).toStrictEqual({
      version: 4,
      intent: "ship that",
      operation: "op-2",
      unsettled,
    });
  },
);

/** A release refused over an override, which the form corrects and nothing
 * else: the revision is what decides whether the form changed, so an override
 * left out of it would ask the refused operation again. */
test("a release refused over an override is released again once the override alone is corrected", async () => {
  const overridden = (setup: string): Body => ({
    ...first,
    overrides: { worker: { setup: [setup] } },
  });
  const api = answeringApi(ticketDoorAnswers(ticketDoor(), ticketRefusedFirst));
  const submit = async (
    body: Body,
    operation: string,
    held?: CreationDraftHeld,
  ) =>
    createAndReleaseTicket(
      api.ports,
      creationPartition,
      { body, operation, held },
      () => undefined,
    );
  const refused = await submit(overridden("x".repeat(9)), "op-1");
  const held = "held" in refused ? refused.held : undefined;
  const from = api.sent.length;
  await submit(overridden("x".repeat(9)), "op-2", held);
  expect(lines(api.sent.slice(from))).toStrictEqual([
    "POST /operations op-1 at 3",
    "GET /operations/op-1",
  ]);

  const again = answeringApi(
    ticketDoorAnswers(ticketDoor(), ticketRefusedFirst),
  );
  const refusedAgain = await createAndReleaseTicket(
    again.ports,
    creationPartition,
    { body: overridden("x".repeat(9)), operation: "op-1" },
    () => undefined,
  );
  const since = again.sent.length;
  const corrected = await createAndReleaseTicket(
    again.ports,
    creationPartition,
    {
      body: overridden("npm ci"),
      operation: "op-2",
      held: "held" in refusedAgain ? refusedAgain.held : undefined,
    },
    () => undefined,
  );
  expect(corrected).toStrictEqual({ created: "Created", ticket: 12 });
  const sent = again.sent.slice(since);
  expect(lines(sent)).toStrictEqual([
    draftRead,
    "PUT /drafts/12 at 3 saying ship it",
    ...released("op-2", 4),
  ]);
  expect(
    (sent[1]?.body as { readonly overrides?: unknown }).overrides,
  ).toStrictEqual({ worker: { setup: ["npm ci"] } });
});
