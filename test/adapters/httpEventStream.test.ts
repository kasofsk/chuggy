/**
 * The event stream route over a real socket: what a browser is answered with
 * before a stream exists, what it reads once one does, and what the stream
 * costs the rest of the server.
 *
 * `app.inject` CANNOT SEE ANY OF IT. A stream hijacks its reply and never
 * finishes, so the injected reply resolves at neither the head nor the frames;
 * every case here holds an ordinary HTTP connection open and reads it.
 *
 * THE HUB IS THE REAL ONE and only the change log and its doorbell are doubles,
 * because the claims being made are about the route, the socket and the
 * representation a row is turned into — each of which the hub is upstream of.
 */

import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  createNativeHttpApp,
  type NativeHttpLimits,
} from "../../src/adapters/http/server.ts";
import { projectResourceReader } from "../../src/adapters/http/eventStream.ts";
import { systemStreamTimers } from "../../src/adapters/runtime/systemStreamTimers.ts";
import {
  projectStreamHub,
  projectStreamLimitsDefault,
  type ProjectStreamLimits,
} from "../../src/interpreter/projectStream.ts";
import {
  asPrincipal,
  asPublicInstant,
  type NativeWeb,
  type TicketNativeAction,
} from "../../src/interpreter/nativeWeb.ts";
import { asInstallationId } from "../../src/domain/ids.ts";
import {
  projectChangeKinds,
  projectChangeRepresentationSchemas,
  type ProjectChangeKind,
} from "../../src/contract/events.ts";
import {
  changeRow,
  fakeDoorbell,
  fakeLog,
  fakeReport,
  partitionOf,
  type FakeDoorbell,
  type FakeLog,
} from "../interpreter/projectStreamHarness.ts";

const partition = partitionOf("project");
const streamPath = "/api/v1/tenants/tenant/projects/project/events";
const authorized = { authorization: "Bearer valid" };

const authority = {
  installationAuthority: () =>
    Promise.resolve(asInstallationId("018f84a1-4c2b-7def-8abc-0123456789ab")),
};

const notFound = () => Promise.resolve({ result: "NotFound" } as const);

type ServedWeb = Pick<
  NativeWeb,
  | "cancel"
  | "configuration"
  | "configurations"
  | "ticketNativeActions"
  | "nativeActions"
  | "createConfiguration"
  | "importRepositoryConfigurations"
  | "createDraft"
  | "initializeDraft"
  | "deleteDraft"
  | "dispatchView"
  | "draft"
  | "notifications"
  | "operation"
  | "project"
  | "projectInventory"
  | "reviseDraft"
  | "submit"
  | "ticket"
  | "execution"
  | "executions"
  | "operationalStatus"
  | "selectorOperationalContext"
  | "outputContent"
  | "runTurns"
  | "runTranscript"
  | "runConfiguration"
>;

function servedWeb(
  readable: boolean,
  actions: () => readonly TicketNativeAction[] | undefined,
): ServedWeb {
  return {
    cancel: notFound,
    configuration: () => Promise.resolve(undefined),
    configurations: notFound,
    ticketNativeActions: () => Promise.resolve(actions()),
    nativeActions: notFound,
    createConfiguration: notFound,
    importRepositoryConfigurations: notFound,
    createDraft: notFound,
    initializeDraft: notFound,
    deleteDraft: notFound,
    dispatchView: notFound,
    draft: () => Promise.resolve(undefined),
    notifications: () =>
      Promise.resolve({
        result: "Authorized",
        value: { result: "Events", cursor: 0, events: [] },
      }),
    operation: (_principal, _partition, operation) =>
      Promise.resolve({
        operation,
        acceptedAt: asPublicInstant("2026-01-01T00:00:00Z"),
        state: "Pending",
      }),
    project: (_principal, asked) =>
      Promise.resolve(
        readable
          ? {
              result: "Found",
              project: { partition: asked, sequence: 9, tickets: [] },
            }
          : { result: "NotFound" },
      ),
    projectInventory: () => Promise.resolve({ projects: [] }),
    reviseDraft: notFound,
    submit: notFound,
    ticket: (_principal, _partition, ticket) =>
      Promise.resolve({
        ticket,
        phase: "Working",
        sequence: 4,
        releasedAt: asPublicInstant("2026-01-01T00:00:00Z"),
        changedAt: asPublicInstant("2026-01-01T00:00:04Z"),
      }),
    execution: () => Promise.resolve(undefined),
    executions: notFound,
    operationalStatus: notFound,
    selectorOperationalContext: notFound,
    outputContent: () => Promise.resolve({ read: "NotFound" }),
    runTurns: () => Promise.resolve(undefined),
    runTranscript: () => Promise.resolve({ read: "NotFound" }),
    runConfiguration: () => Promise.resolve({ read: "NotFound" }),
  };
}

interface Served {
  readonly port: number;
  readonly log: FakeLog;
  readonly doorbell: FakeDoorbell;
  close(): Promise<void>;
}

async function served(
  options: {
    readable?: boolean;
    limits?: Partial<ProjectStreamLimits>;
    httpLimits?: NativeHttpLimits;
    expiresInMs?: number;
    actions?: () => readonly TicketNativeAction[] | undefined;
  } = {},
): Promise<Served> {
  const log = fakeLog();
  const doorbell = fakeDoorbell();
  const web = servedWeb(
    options.readable ?? true,
    options.actions ?? (() => []),
  );
  const hub = projectStreamHub({
    log: log.log,
    doorbell: doorbell.doorbell,
    reader: projectResourceReader(web),
    timers: systemStreamTimers,
    report: fakeReport().report,
    limits: { ...projectStreamLimitsDefault, ...options.limits },
  });
  const app = createNativeHttpApp(
    web,
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          token === "valid"
            ? {
                authenticated: "Bearer" as const,
                bearer: {
                  principal: asPrincipal("issuer\u0000subject"),
                  ...(options.expiresInMs === undefined
                    ? {}
                    : { expiresAtMs: Date.now() + options.expiresInMs }),
                },
              }
            : { authenticated: "InvalidToken" as const },
        ),
    },
    { ready: () => Promise.resolve(true) },
    authority,
    options.httpLimits,
    hub,
  );
  app.addHook("onClose", () => hub.close());
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address !== null && typeof address !== "string");
  return {
    port: address.port,
    log,
    doorbell,
    close: async () => {
      await hub.close();
      await app.close();
    },
  };
}

interface Held {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  body(): string;
  /** Whether the server has ended the response, which is how a stream ends. */
  closed(): boolean;
  close(): void;
}

function held(
  port: number,
  path: string,
  headers: Readonly<Record<string, string>>,
): Promise<Held> {
  return new Promise((resolve, reject) => {
    let body = "";
    const request = http.request(
      { host: "127.0.0.1", port, path, headers },
      (response) => {
        let ended = false;
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          ended = true;
        });
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: () => body,
          closed: () => ended,
          close: () => {
            request.destroy();
          },
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/** A request the case abandons before any head arrives, which is what a flaky link does. */
function abandoning(
  port: number,
  path: string,
  headers: Readonly<Record<string, string>>,
): http.ClientRequest {
  const request = http.request({ host: "127.0.0.1", port, path, headers });
  request.on("error", () => undefined);
  request.end();
  return request;
}

const pollAttemptsMax = 400;
const pollIntervalMs = 10;

async function reaches(reading: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < pollAttemptsMax; attempt += 1) {
    if (reading()) return true;
    await delay(pollIntervalMs);
  }
  return false;
}

/** Every `data:` payload the stream carried, in the order it carried them. */
function payloads(found: Held): unknown[] {
  return found
    .body()
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as unknown);
}

function identities(found: Held): string[] {
  return found
    .body()
    .split("\n")
    .filter((line) => line.startsWith("event: ") || line.startsWith("id: "))
    .map((line) => line.trim());
}

/** The representation the newest change frame carried. */
function changeData(found: Held): unknown {
  const last = payloads(found).at(-1);
  assert.ok(last !== null && typeof last === "object");
  return (last as { representation: unknown }).representation;
}

const open: Held[] = [];
const running: Served[] = [];

async function stream(
  rig: Served,
  headers: Readonly<Record<string, string>> = authorized,
  path = streamPath,
): Promise<Held> {
  const found = await held(rig.port, path, headers);
  open.push(found);
  return found;
}

async function rigOf(
  options: Parameters<typeof served>[0] = {},
): Promise<Served> {
  const rig = await served(options);
  running.push(rig);
  return rig;
}

after(async () => {
  for (const found of open) found.close();
  for (const rig of running) await rig.close();
});

test("a stream without a bearer is refused before a stream exists", async () => {
  const rig = await rigOf();
  const refused = await stream(rig, {});
  assert.equal(refused.status, 401);
  assert.equal(refused.headers["www-authenticate"], "Bearer");
  assert.ok(!(refused.headers["content-type"] ?? "").includes("event-stream"));
});

test("a partition the bearer cannot read is concealed as a not-found", async () => {
  const rig = await rigOf({ readable: false });
  const refused = await stream(rig);
  assert.equal(refused.status, 404);
  assert.ok(
    (refused.headers["content-type"] ?? "").includes("vnd.chuggy.v1+json"),
  );
});

test("a fresh stream is answered with an unbuffered event stream head", async () => {
  const rig = await rigOf();
  const opened = await stream(rig);
  assert.equal(opened.status, 200);
  assert.equal(opened.headers["content-type"], "text/event-stream");
  assert.equal(opened.headers["cache-control"], "no-store");
  assert.equal(opened.headers["x-accel-buffering"], "no");
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  assert.deepEqual(identities(opened), ["event: ready", "event: source"]);
});

test("a live change arrives as the kind's own GET representation", async () => {
  const rig = await rigOf();
  const opened = await stream(rig);
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  rig.log.append(changeRow(41, partition, "Ticket", "3"));
  rig.doorbell.ring();
  assert.ok(await reaches(() => opened.body().includes("event: Ticket")));
  assert.deepEqual(identities(opened).slice(2), ["event: Ticket", "id: 41"]);
  assert.deepEqual(
    projectChangeRepresentationSchemas.Ticket.parse(changeData(opened)),
    {
      ticket: 3,
      phase: "Working",
      sequence: 4,
      releasedAt: "2026-01-01T00:00:00Z",
      changedAt: "2026-01-01T00:00:04Z",
    },
  );
});

/**
 * The resource each kind's read is driven with. Two are absent because the API
 * holds no read for them yet, and the test below is what says so rather than
 * leaving them quietly unexercised.
 */
const kindResources: Readonly<Record<ProjectChangeKind, string | undefined>> = {
  Operation: "operation-one",
  Ticket: "3",
  Draft: "3",
  Configuration: "revision-one",
  Project: "project",
  Execution: "execution-one",
  NativeAction: "3",
  AgenticRefusal: undefined,
  Session: undefined,
};

test("a kind whose read the API does not hold is refused, not guessed at", async () => {
  const reader = projectResourceReader(servedWeb(true, () => []));
  const absent = projectChangeKinds.filter(
    (kind) => kindResources[kind] === undefined,
  );
  assert.deepEqual(absent, ["AgenticRefusal", "Session"]);
  for (const kind of absent)
    await assert.rejects(
      () =>
        reader.read(asPrincipal("issuer\u0000subject"), partition, kind, "3"),
      RangeError,
    );
});

test("every kind the log can name reaches the stream as its own schema", async () => {
  const rig = await rigOf();
  const opened = await stream(rig);
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  let sequence = 100;
  for (const kind of projectChangeKinds) {
    const resource = kindResources[kind];
    if (resource === undefined) continue;
    rig.log.append(changeRow(sequence, partition, kind, resource));
    sequence += 1;
    rig.doorbell.ring();
    assert.ok(
      await reaches(() => opened.body().includes(`event: ${kind}`)),
      `${kind} reached the stream`,
    );
    projectChangeRepresentationSchemas[kind]
      .nullable()
      .parse(changeData(opened));
  }
});

test("an approval reaches the stream when it opens and again when it is answered", async () => {
  const approval: TicketNativeAction = {
    action: "approval-one",
    kind: "FinalizationApproval",
    authorizingSequence: 11,
    admits: ["Approve", "Decline"],
  };
  let waiting = true;
  const rig = await rigOf({ actions: () => (waiting ? [approval] : []) });
  const opened = await stream(rig);
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  rig.log.append(changeRow(51, partition, "NativeAction", "3"));
  rig.doorbell.ring();
  assert.ok(await reaches(() => opened.body().includes("id: 51")));
  assert.deepEqual(
    projectChangeRepresentationSchemas.NativeAction.parse(changeData(opened)),
    { actions: [approval] },
  );
  waiting = false;
  rig.log.append(changeRow(52, partition, "NativeAction", "3"));
  rig.doorbell.ring();
  assert.ok(await reaches(() => opened.body().includes("id: 52")));
  assert.deepEqual(
    projectChangeRepresentationSchemas.NativeAction.parse(changeData(opened)),
    { actions: [] },
  );
});

test("a project change carries the entry the inventory would list", async () => {
  const rig = await rigOf();
  const opened = await stream(rig);
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  rig.log.append(changeRow(7, partition, "Project", "project"));
  rig.doorbell.ring();
  assert.ok(await reaches(() => opened.body().includes("event: Project")));
  assert.deepEqual(
    projectChangeRepresentationSchemas.Project.parse(changeData(opened)),
    { tenant: "tenant", project: "project" },
  );
});

test("a reconnect names its place by header or by the fetch client's query", async () => {
  const rig = await rigOf();
  rig.log.append(changeRow(1, partition, "Ticket", "1"));
  rig.log.append(changeRow(2, partition, "Ticket", "2"));
  const byHeader = await stream(rig, { ...authorized, "last-event-id": "1" });
  assert.ok(await reaches(() => byHeader.body().includes("event: source")));
  assert.deepEqual(identities(byHeader), [
    "event: Ticket",
    "id: 2",
    "event: source",
  ]);
  const byQuery = await stream(rig, authorized, `${streamPath}?after=1`);
  assert.ok(await reaches(() => byQuery.body().includes("event: source")));
  assert.deepEqual(identities(byQuery), identities(byHeader));
});

test("a place the log never held is refused as a request fault", async () => {
  const rig = await rigOf();
  const refused = await stream(rig, { ...authorized, "last-event-id": "01" });
  assert.equal(refused.status, 400);
});

test("a stream outlives the request timeout every other route takes", async () => {
  const rig = await rigOf({
    httpLimits: { concurrentRequestsMax: 64, requestTimeoutMs: 200 },
    limits: { heartbeatMs: 50 },
  });
  const opened = await stream(rig);
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  await delay(600);
  rig.log.append(changeRow(3, partition, "Ticket", "3"));
  rig.doorbell.ring();
  assert.ok(await reaches(() => opened.body().includes("event: Ticket")));
  assert.ok(opened.body().includes(":\n\n"));
});

test("streams take none of the slots an ordinary request queues for", async () => {
  const rig = await rigOf({
    httpLimits: { concurrentRequestsMax: 1, requestTimeoutMs: 15_000 },
  });
  const first = await stream(rig);
  const second = await stream(rig);
  assert.ok(await reaches(() => second.body().includes("event: source")));
  assert.equal(first.status, 200);
  const live = await fetch(`http://127.0.0.1:${String(rig.port)}/health/live`);
  await live.arrayBuffer();
  assert.equal(live.status, 200);
});

test("past the stream cap the answer is a refusal and not a stream", async () => {
  const rig = await rigOf({ limits: { connectionsMax: 1 } });
  const opened = await stream(rig);
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  const refused = await stream(rig);
  assert.equal(refused.status, 503);
  assert.equal(refused.headers["retry-after"], "1");
  assert.ok(
    (refused.headers["content-type"] ?? "").includes("vnd.chuggy.v1+json"),
  );
  assert.ok(await reaches(() => refused.body().includes("ServerBusy")));
});

test("a client that goes away gives its stream back to the cap", async () => {
  const rig = await rigOf({ limits: { connectionsMax: 1 } });
  const opened = await stream(rig);
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  opened.close();
  const next = await stream(rig);
  assert.ok(await reaches(() => next.body().includes("event: source")));
  assert.equal(next.status, 200);
});

test("a client that goes away mid-open gives its slot back", async () => {
  const rig = await rigOf({ limits: { connectionsMax: 1 } });
  rig.log.append(changeRow(1, partition, "Ticket", "3"));
  const release = rig.log.holdsReplays();
  const abandoned = abandoning(rig.port, streamPath, {
    ...authorized,
    "last-event-id": "0",
  });
  await delay(100);
  abandoned.destroy();
  await delay(100);
  release();
  const next = await stream(rig);
  assert.ok(
    await reaches(() => next.body().includes("event: source")),
    "the abandoned stream never gave its slot back",
  );
  assert.equal(next.status, 200);
});

test("an opening read that fails is answered as a fault, never as a stream", async () => {
  const rig = await rigOf();
  rig.log.append(changeRow(1, partition, "Ticket", "3"));
  rig.log.failsReplays();
  const refused = await stream(rig, { ...authorized, "last-event-id": "0" });
  assert.equal(refused.status, 500);
  assert.ok(
    (refused.headers["content-type"] ?? "").includes("vnd.chuggy.v1+json"),
  );
  assert.ok(await reaches(() => refused.body().includes("InternalError")));
});

test("a stream ends when the bearer that opened it does", async () => {
  const rig = await rigOf({ expiresInMs: 700, limits: { heartbeatMs: 50 } });
  const opened = await stream(rig);
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  assert.ok(
    await reaches(() => opened.closed()),
    "the stream outlived its bearer",
  );
});

test("a stream whose bearer names no expiry runs to its own age", async () => {
  const rig = await rigOf({ limits: { heartbeatMs: 50, maxAgeMs: 700 } });
  const opened = await stream(rig);
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  assert.ok(await reaches(() => opened.closed()));
  assert.ok(opened.body().includes(":\n\n"));
});

test("a change never reaches a stream on another tenant's namesake project", async () => {
  const rig = await rigOf();
  const mine = await stream(rig);
  const theirs = await stream(
    rig,
    authorized,
    "/api/v1/tenants/other-tenant/projects/project/events",
  );
  assert.ok(await reaches(() => theirs.body().includes("event: source")));
  rig.log.append(changeRow(5, partition, "Ticket", "3"));
  rig.doorbell.ring();
  assert.ok(await reaches(() => mine.body().includes("event: Ticket")));
  await delay(100);
  assert.ok(!theirs.body().includes("event: Ticket"));
});

test("closing the app ends every stream instead of draining behind one", async () => {
  const rig = await served({});
  const opened = await held(rig.port, streamPath, authorized);
  assert.ok(await reaches(() => opened.body().includes("event: source")));
  const started = Date.now();
  await rig.close();
  assert.ok(Date.now() - started < 5_000);
  opened.close();
});
