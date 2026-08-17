/**
 * The face's own promises: who it serves, what it does with a refusal, and what
 * a page it renders may not contain.
 *
 * NOTHING HERE REACHES A NETWORK. The verifier is a value, so these cases hand
 * it a key set generated in this process and sign their own tokens against the
 * matching key — the same verification the deployment runs, against keys a
 * suite owns. A case that needed Google to answer would be a case that stops
 * being run.
 *
 * MOST CASES DRIVE THE ROUTER AND TWO DRIVE A SOCKET. The routing, the
 * identity and the refusals are one layer in from the transport and are asked
 * there; the two that go through a listening server are the ones whose subject
 * IS the transport — a failure turned into an answer, and the deployment's own
 * adapters carrying an arrival and a release end to end.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { test, type TestContext } from "node:test";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { actorInit } from "../../src/actor/state.ts";
import { deskEvents } from "../../src/adapters/deskEvents.ts";
import { fabricStub } from "../../src/adapters/fabricStub.ts";
import {
  httpApiArtifacts,
  type HttpApiArtifacts,
} from "../../src/adapters/httpApi/artifacts.ts";
import type { Identity } from "../../src/adapters/httpApi/identity.ts";
import { httpApiJobTokenMint } from "../../src/adapters/httpApi/jobToken.ts";
import {
  httpApiBody,
  httpApiBodyBytesMax,
  httpApiFields,
} from "../../src/adapters/httpApi/request.ts";
import {
  httpApiRouter,
  httpApiSerialArrivals,
  type HttpApiAnswer,
  type HttpApiDesk,
  type HttpApiRequest,
  type HttpApiRouter,
} from "../../src/adapters/httpApi/routes.ts";
import { httpApi } from "../../src/adapters/httpApi/server.ts";
import {
  journalStoreStub,
  type JournalStoreStub,
} from "../../src/adapters/journalStoreStub.ts";
import { registrySqlite } from "../../src/adapters/registrySqlite.ts";
import { sqliteJournal } from "../../src/adapters/sqliteJournal.ts";
import { wrapUpStub } from "../../src/adapters/wrapUpStub.ts";
import type { Config } from "../../src/domain/config.ts";
import { asTaskId, asTicketId, type TicketId } from "../../src/domain/ids.ts";
import { budgeted, reworkBudgetOf } from "../../src/domain/pricing.ts";
import type { Ticket } from "../../src/domain/ticket.ts";
import {
  workBranch,
  type ArtifactBody,
  type CompletionDeclaration,
} from "../../src/interpreter/artifact.ts";
import type { Executor } from "../../src/interpreter/executor.ts";
import type { Submitted } from "../../src/interpreter/inbound.ts";
import type {
  DeskLog,
  Registry,
  RegistryUser,
} from "../../src/interpreter/registry.ts";
import { boot } from "../../src/runtime/boot.ts";
import { drive, type Drive } from "../../src/runtime/drive.ts";
import { ticketOn } from "../domain/fixtures.ts";

/** The instance these cases drive: a fleet small enough to fill, and a program of one stage. */
const httpApiConfig: Config = {
  nTickets: 3,
  nTasks: 1,
  reworkPolicy: reworkBudgetOf(1),
  gas: 3,
  wrapUpPricing: budgeted(1),
  opRetryPricing: "RetryCharged",
  maxStages: 1,
  nProjects: 2,
};

const httpApiAlgorithm = "RS256";
const httpApiKeyId = "desk";
const httpApiIssuer = "https://issuer.test";
const httpApiAudience = "chuggy-desk";

const httpApiPair = await generateKeyPair(httpApiAlgorithm, {
  extractable: true,
});

/** The verifier every case is wired with: this process's own public key, under the issuer and audience below. */
const httpApiIdentity: Identity = {
  keys: createLocalJWKSet({
    keys: [
      {
        ...(await exportJWK(httpApiPair.publicKey)),
        alg: httpApiAlgorithm,
        kid: httpApiKeyId,
      },
    ],
  }),
  issuer: httpApiIssuer,
  audience: httpApiAudience,
};

/** A token this suite signs, at whatever claims a case needs it to carry. */
function httpApiToken(draw: {
  readonly subject: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly expires?: string | number;
}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: httpApiAlgorithm, kid: httpApiKeyId })
    .setIssuer(draw.issuer ?? httpApiIssuer)
    .setAudience(draw.audience ?? httpApiAudience)
    .setSubject(draw.subject)
    .setIssuedAt()
    .setExpirationTime(draw.expires ?? "1h")
    .sign(httpApiPair.privateKey);
}

/** What a case drives: the router, and the stores standing behind it. */
interface HttpApiWiring {
  readonly route: HttpApiRouter;
  readonly desk: HttpApiDesk;
  readonly registry: Registry;
  readonly artifacts: HttpApiArtifacts;
  readonly store: JournalStoreStub;
}

/** The secret these cases key a job token with; no case here mints one, and a face still needs one to refuse with. */
const httpApiJobSecret = "the-desk-suite-secret";

/** The face over one desk value, so a case that wires its own stores still routes through the same code. */
function httpApiFace(
  config: Config,
  driven: Drive,
  registry: Registry,
  log: DeskLog,
  artifacts: HttpApiArtifacts,
): HttpApiDesk {
  return {
    config,
    inbound: driven,
    core: driven.core,
    registry,
    deskLog: log,
    artifacts,
    identity: httpApiIdentity,
    oauthClientId: httpApiAudience,
    jobSecret: httpApiJobSecret,
  };
}

/** A desk over in-memory stores and a drive over the stub world; either store may be wrapped to fail a write. */
function httpApiWiring(
  t: TestContext,
  wrap: (registry: Registry) => Registry = (registry) => registry,
  cut: (driven: Drive) => Drive = (driven) => driven,
): HttpApiWiring {
  const database = new DatabaseSync(":memory:");
  t.after(() => {
    database.close();
  });
  const log = deskEvents(database);
  const registry = wrap(registrySqlite(database));
  const store = journalStoreStub();
  const executor: Executor = {
    config: httpApiConfig,
    store,
    ports: { fabric: fabricStub(), desk: log, wrapUp: wrapUpStub() },
  };
  const driven = cut(drive(executor, () => undefined, actorInit()));
  const artifacts = httpApiArtifacts(database);
  const desk = httpApiFace(httpApiConfig, driven, registry, log, artifacts);
  return { route: httpApiRouter(desk), desk, registry, artifacts, store };
}

/** One request as the transport would have read it, carrying only what a case names. */
function httpApiAsk(draw: Partial<HttpApiRequest>): HttpApiRequest {
  return {
    method: "GET",
    path: "/",
    authorization: undefined,
    cookie: undefined,
    accept: undefined,
    contentType: "application/json",
    body: "",
    ...draw,
  };
}

/** The request a signed-in caller makes, with the token in the header the face reads first. */
async function httpApiSigned(
  subject: string,
  draw: Partial<HttpApiRequest>,
): Promise<HttpApiRequest> {
  const token = await httpApiToken({ subject });
  return httpApiAsk({ authorization: `Bearer ${token}`, ...draw });
}

/** A JSON body, as a caller that is not a browser sends one. */
function httpApiPosts(value: unknown): Partial<HttpApiRequest> {
  return { method: "POST", body: JSON.stringify(value) };
}

/** The arrival a case makes when it needs a ticket to act on. */
function httpApiArrives(
  title: string,
  wrapUp = "WNone",
): Partial<HttpApiRequest> {
  return {
    path: "/api/tickets",
    ...httpApiPosts({
      title,
      brief: "the face the fabric never sees",
      taskType: "code",
      project: 1,
      wrapUp,
    }),
  };
}

/** The answer's JSON, which every answer but a page carries. */
function httpApiRead(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

/**
 * An inbound face that grows the fleet, yields, and only then answers — legal
 * under `Inbound`, which promises nothing about when a submission's caller
 * resumes. It is what opens the window the serializer closes, and the drive's
 * own chaining happens to keep that window shut, which is why proving the
 * serializer needs a face that schedules differently.
 */
function httpApiInterleavingDrive(): Drive {
  const tickets = new Map<TicketId, Ticket>();
  const refuse = (): Promise<Submitted> =>
    Promise.resolve({ submitted: "Dropped", why: "this face only arrives" });
  return {
    arrive: async () => {
      const made = asTicketId(tickets.size + 1);
      tickets.set(made, ticketOn(httpApiConfig, 1));
      await new Promise<void>((resolve) => {
        setImmediate(() => {
          resolve();
        });
      });
      return { submitted: "Accepted", seq: made };
    },
    release: refuse,
    revoke: refuse,
    opRetry: refuse,
    taskDone: refuse,
    gateOutcome: refuse,
    core: () => ({ tickets }),
  };
}

/** A body arriving in chunks, the way a socket hands one over. */
function httpApiChunks(count: number, bytes: number): AsyncIterable<Buffer> {
  const parts: Buffer[] = [];
  for (let at = 0; at < count; at++) parts.push(Buffer.alloc(bytes, 0x61));
  return Readable.from(parts);
}

/**
 * The title that landed under each answer's own ticket id. Concurrent arrivals
 * enter the lock in whatever order their tokens finished verifying, so what is
 * asserted is the pairing rather than the order.
 */
async function httpApiLanded(
  registry: Registry,
  answers: readonly HttpApiAnswer[],
): Promise<readonly (string | undefined)[]> {
  const annexes = await registry.annexes();
  return answers.map(
    (answer) =>
      annexes.get(asTicketId(Number(httpApiRead(answer.body)["ticket"])))
        ?.title,
  );
}

/** The ids a run of arrivals answered with, ascending. */
function httpApiMade(answers: readonly HttpApiAnswer[]): readonly number[] {
  return answers
    .map((answer) => Number(httpApiRead(answer.body)["ticket"]))
    .sort((left, right) => left - right);
}

/** The two callers most cases need: an author the registry admits, and an operator. */
async function httpApiAdmit(registry: Registry): Promise<void> {
  await registry.upsertUser("author", "Ada", false);
  await registry.upsertUser("operator", "Grace", true);
}

/** A listening server on a port the operating system picked, closed when the case ends. */
async function httpApiListening(
  t: TestContext,
  server: Server,
): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return `http://127.0.0.1:${String(port)}`;
}

test("healthz answers with no token at all", async (t) => {
  const wired = httpApiWiring(t);
  const answer = await wired.route(httpApiAsk({ path: "/healthz" }));
  assert.equal(answer.status, 200);
  assert.deepEqual(httpApiRead(answer.body), { serving: true });
});

test("a verified token whose subject the registry holds is served", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  const answer = await wired.route(
    await httpApiSigned("author", { path: "/api/tickets" }),
  );
  assert.equal(answer.status, 200);
  assert.deepEqual(httpApiRead(answer.body), { board: [] });
});

test("a verified token whose subject the registry does not hold is refused", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  const answer = await wired.route(
    await httpApiSigned("stranger", { path: "/api/tickets" }),
  );
  assert.equal(answer.status, 403);
  assert.match(String(httpApiRead(answer.body)["why"]), /stranger/);
});

test("a token that does not verify names nobody, whatever is wrong with it", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  const expired = Math.floor(Date.now() / 1000) - 60;
  const wrong = [
    "not.a.token",
    await httpApiToken({ subject: "author", audience: "some-other-client" }),
    await httpApiToken({ subject: "author", issuer: "https://elsewhere.test" }),
    await httpApiToken({ subject: "author", expires: expired }),
  ];
  for (const token of wrong) {
    const answer = await wired.route(
      httpApiAsk({ path: "/api/tickets", authorization: `Bearer ${token}` }),
    );
    assert.equal(answer.status, 401, token);
  }
  const none = await wired.route(httpApiAsk({ path: "/api/tickets" }));
  assert.equal(none.status, 401);
});

test("a session cookie this desk cannot read names nobody rather than failing", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  const answer = await wired.route(
    httpApiAsk({ path: "/", accept: "text/html", cookie: "chuggy_session=%" }),
  );
  assert.equal(answer.status, 401);
  assert.ok(answer.body.includes("sign in"));
});

test("a body at the cap is read, and one past it is refused with the cap named", async () => {
  const half = httpApiBodyBytesMax / 2;
  const whole = await httpApiBody(httpApiChunks(2, half));
  assert.ok(whole.parsed === "Ok");
  assert.equal(whole.value.length, httpApiBodyBytesMax);
  const over = await httpApiBody(httpApiChunks(2, half + 1));
  assert.ok(over.parsed === "Refused");
  assert.ok(over.why.includes(String(httpApiBodyBytesMax)));
});

test("an arrival answers with the id it made, and the annex is written beside it", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  const answer = await wired.route(
    await httpApiSigned("author", httpApiArrives("wire the desk")),
  );
  assert.equal(answer.status, 200);
  assert.deepEqual(httpApiRead(answer.body), { ticket: 1, seq: 1 });
  const annex = (await wired.registry.annexes()).get(asTicketId(1));
  assert.equal(annex?.title, "wire the desk");
  assert.equal(annex?.author, "author");
});

test("two arrivals at once land their annexes under the ids they made", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  const asks = [
    await httpApiSigned("author", httpApiArrives("first")),
    await httpApiSigned("author", httpApiArrives("second")),
  ];
  const both = await Promise.all(asks.map((ask) => wired.route(ask)));
  assert.deepEqual(httpApiMade(both), [1, 2]);
  assert.equal((await wired.registry.annexes()).size, 2);
  assert.deepEqual(await httpApiLanded(wired.registry, both), [
    "first",
    "second",
  ]);
});

test("the serializer is what keeps two annexes from landing under one id", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => {
    database.close();
  });
  const registry = registrySqlite(database);
  const desk = httpApiFace(
    httpApiConfig,
    httpApiInterleavingDrive(),
    registry,
    deskEvents(database),
    httpApiArtifacts(database),
  );
  const arrive = httpApiSerialArrivals();
  const author: RegistryUser = {
    subject: "author",
    display: "Ada",
    admin: false,
  };
  const both = await Promise.all(
    ["first", "second"].map((title) => {
      const ask = httpApiAsk(httpApiArrives(title));
      const read = httpApiFields(ask.contentType, ask.body);
      assert.ok(read.parsed === "Ok");
      return arrive(desk, ask, author, read.value);
    }),
  );
  assert.deepEqual(httpApiMade(both), [1, 2]);
  assert.equal((await registry.annexes()).size, 2);
  assert.deepEqual(await httpApiLanded(registry, both), ["first", "second"]);
});

test("an arrival the machine will not take is answered with its own reason", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  for (let made = 0; made < httpApiConfig.nTickets; made++) {
    const room = await wired.route(
      await httpApiSigned("author", httpApiArrives(`ticket ${String(made)}`)),
    );
    assert.equal(room.status, 200);
  }
  const full = await wired.route(
    await httpApiSigned("author", httpApiArrives("one too many")),
  );
  assert.equal(full.status, 409);
  assert.match(String(httpApiRead(full.body)["why"]), /JArrive/);
  assert.equal((await wired.registry.annexes()).size, httpApiConfig.nTickets);
});

test("release, revoke and retry go through the face, and a refusal is the answer", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  await wired.route(await httpApiSigned("author", httpApiArrives("a ticket")));
  const released = await wired.route(
    await httpApiSigned("author", {
      path: "/api/tickets/1/release",
      ...httpApiPosts({}),
    }),
  );
  assert.equal(released.status, 200);
  const again = await wired.route(
    await httpApiSigned("author", {
      path: "/api/tickets/1/release",
      ...httpApiPosts({}),
    }),
  );
  assert.equal(again.status, 409);
  assert.match(String(httpApiRead(again.body)["why"]), /JRelease/);
  const retried = await wired.route(
    await httpApiSigned("author", {
      path: "/api/tickets/1/retry",
      ...httpApiPosts({}),
    }),
  );
  assert.equal(retried.status, 409);
  const revoked = await wired.route(
    await httpApiSigned("author", {
      path: "/api/tickets/1/revoke",
      ...httpApiPosts({}),
    }),
  );
  assert.equal(revoked.status, 200);
});

test("the gate is the operator's alone, and enablement still answers it", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  await wired.route(await httpApiSigned("author", httpApiArrives("a ticket")));
  const gate = {
    path: "/api/tickets/1/gate",
    ...httpApiPosts({ outcome: "WOk" }),
  };
  const refused = await wired.route(await httpApiSigned("author", gate));
  assert.equal(refused.status, 403);
  const held = await wired.route(await httpApiSigned("operator", gate));
  assert.equal(held.status, 409);
  assert.match(String(httpApiRead(held.body)["why"]), /JGateResolve/);
});

test("the registry is written by an operator alone", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  const row = {
    path: "/api/users",
    ...httpApiPosts({ subject: "newcomer", display: "Alan", admin: "false" }),
  };
  const refused = await wired.route(await httpApiSigned("author", row));
  assert.equal(refused.status, 403);
  assert.equal(await wired.registry.userBySubject("newcomer"), undefined);
  const written = await wired.route(await httpApiSigned("operator", row));
  assert.equal(written.status, 200);
  assert.deepEqual(await wired.registry.userBySubject("newcomer"), {
    subject: "newcomer",
    display: "Alan",
    admin: false,
  });
});

test("a title carrying markup renders as the text it is", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  await wired.route(
    await httpApiSigned("author", httpApiArrives("<script>alert(1)</script>")),
  );
  const page = await wired.route(
    await httpApiSigned("author", { path: "/", accept: "text/html" }),
  );
  assert.equal(page.status, 200);
  assert.ok(page.body.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!page.body.includes("<script"));
});

test("the board is the live core, joined with the annex", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  await wired.route(await httpApiSigned("author", httpApiArrives("first")));
  await wired.route(await httpApiSigned("author", httpApiArrives("second")));
  const drafts = await wired.route(
    await httpApiSigned("author", { path: "/api/tickets" }),
  );
  assert.deepEqual(JSON.parse(drafts.body), {
    board: [
      httpApiExpectedRow(1, "PDraft", "first", ["release", "revoke"]),
      httpApiExpectedRow(2, "PDraft", "second", ["release", "revoke"]),
    ],
  });
  await wired.route(
    await httpApiSigned("author", {
      path: "/api/tickets/1/release",
      ...httpApiPosts({}),
    }),
  );
  const moved = await wired.route(
    await httpApiSigned("author", { path: "/api/tickets/1" }),
  );
  const ticket = httpApiRead(moved.body)["ticket"] as {
    row: { phase: string; actions: readonly string[] };
    tasks: readonly unknown[];
  };
  assert.equal(ticket.row.phase, "PWorking");
  assert.deepEqual(ticket.row.actions, ["revoke"]);
  assert.equal(ticket.tasks.length, httpApiConfig.nTasks);
});

/** One board row as the projection renders it, so a case states the whole answer rather than a field of it. */
function httpApiExpectedRow(
  ticket: number,
  phase: string,
  title: string,
  actions: readonly string[],
): unknown {
  return {
    ticket,
    phase,
    project: 1,
    annex: {
      title,
      brief: "the face the fabric never sees",
      taskType: "code",
      author: "author",
    },
    gasLeft: httpApiConfig.gas,
    reworkLeft: 1,
    wrapUpLeft: 1,
    actions,
  };
}

test("the sign-in exchange hands back the cookie the desk then reads", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  const credential = await httpApiToken({ subject: "author" });
  const body = new URLSearchParams({
    credential,
    g_csrf_token: "a-csrf-token",
  }).toString();
  const session = httpApiAsk({
    method: "POST",
    path: "/session",
    contentType: "application/x-www-form-urlencoded",
    cookie: "g_csrf_token=a-csrf-token",
    body,
  });
  const opened = await wired.route(session);
  assert.equal(opened.status, 303);
  assert.match(String(opened.headers["set-cookie"]), /^chuggy_session=/);
  const carried = await wired.route(
    httpApiAsk({
      path: "/api/tickets",
      cookie: `chuggy_session=${encodeURIComponent(credential)}`,
    }),
  );
  assert.equal(carried.status, 200);
});

test("a sign-in post whose cross-site token does not match is refused", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  const credential = await httpApiToken({ subject: "author" });
  const answer = await wired.route(
    httpApiAsk({
      method: "POST",
      path: "/session",
      contentType: "application/x-www-form-urlencoded",
      cookie: "g_csrf_token=one",
      body: new URLSearchParams({ credential, g_csrf_token: "two" }).toString(),
    }),
  );
  assert.equal(answer.status, 401);
});

test("a body past the cap is refused before anything of it is parsed", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiAdmit(wired.registry);
  const base = await httpApiListening(t, httpApi(wired.desk));
  const token = await httpApiToken({ subject: "author" });
  const answer = await fetch(`${base}/api/tickets`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "x".repeat(httpApiBodyBytesMax + 1),
  });
  assert.equal(answer.status, 413);
  const refused = (await answer.json()) as Record<string, unknown>;
  assert.equal(refused["refused"], "the body is too large");
  assert.ok(String(refused["why"]).includes(String(httpApiBodyBytesMax)));
  assert.equal((await wired.registry.annexes()).size, 0);
});

test("an arrival whose annex write fails leaves a draft the board still renders", async (t) => {
  const wired = httpApiWiring(t, (registry) => ({
    ...registry,
    writeAnnex: () => Promise.reject(new Error("the annex write was cut off")),
  }));
  await httpApiAdmit(wired.registry);
  const base = await httpApiListening(t, httpApi(wired.desk));
  const token = await httpApiToken({ subject: "author" });
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const cut = await fetch(`${base}/api/tickets`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "never annexed",
      taskType: "code",
      project: 1,
    }),
  });
  assert.equal(cut.status, 500);
  const board = await fetch(`${base}/api/tickets`, { headers });
  const rows = (await board.json()) as { board: Record<string, unknown>[] };
  assert.equal(rows.board.length, 1);
  assert.equal(rows.board[0]?.["annex"], undefined);
  const page = await fetch(`${base}/`, {
    headers: { authorization: `Bearer ${token}`, accept: "text/html" },
  });
  assert.ok((await page.text()).includes("(no annex)"));
});

test("the deployment's own adapters carry an arrival and a release end to end", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "chuggy-desk-"));
  const database = new DatabaseSync(join(directory, "chuggy.sqlite"));
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const log = deskEvents(database);
  const registry = registrySqlite(database);
  const executor: Executor = {
    config: httpApiConfig,
    store: sqliteJournal(database),
    ports: { fabric: fabricStub(), desk: log, wrapUp: wrapUpStub() },
  };
  const driven = drive(executor, () => undefined, await boot(executor));
  await registry.upsertUser("operator", "Grace", true);
  const base = await httpApiListening(
    t,
    httpApi(
      httpApiFace(
        httpApiConfig,
        driven,
        registry,
        log,
        httpApiArtifacts(database),
      ),
    ),
  );
  const token = await httpApiToken({ subject: "operator" });
  const form = {
    authorization: `Bearer ${token}`,
    "content-type": "application/x-www-form-urlencoded",
    accept: "text/html",
  };
  const arrived = await fetch(`${base}/api/tickets`, {
    method: "POST",
    headers: form,
    redirect: "manual",
    body: new URLSearchParams({
      title: "served over a socket",
      taskType: "code",
      project: "1",
      wrapUp: "WNone",
    }).toString(),
  });
  assert.equal(arrived.status, 303);
  assert.equal(arrived.headers.get("location"), "/tickets/1");
  const released = await fetch(`${base}/api/tickets/1/release`, {
    method: "POST",
    headers: form,
    redirect: "manual",
    body: "",
  });
  assert.equal(released.status, 303);
  const board = await fetch(base, {
    headers: { authorization: `Bearer ${token}`, accept: "text/html" },
  });
  const page = await board.text();
  assert.equal(board.status, 200);
  assert.ok(page.includes("served over a socket"));
  assert.ok(page.includes("PWorking"));
  assert.deepEqual(
    (await log.eventsFor(asTicketId(1))).map((event) => event.effect),
    ["CreateDraft"],
  );
});

/** The mint a job is handed at spawn, keyed by the secret the face verifies against. */
const httpApiMint = httpApiJobTokenMint(httpApiJobSecret);

/** The token a real job holds for one ticket's task. */
function httpApiJobToken(ticket: number, task: number): string {
  return httpApiMint(asTicketId(ticket), asTaskId(task));
}

/** The completion one job posts, at whichever token a case wants it to carry. */
function httpApiCompletes(
  ticket: number,
  task: number,
  declared: CompletionDeclaration,
  token: string,
): Partial<HttpApiRequest> {
  return {
    path: `/internal/tasks/${String(ticket)}/${String(task)}/completion`,
    authorization: `Bearer ${token}`,
    ...httpApiPosts(declared),
  };
}

/** The step labels the store kept, which is where a decision taken is told from one refused. */
function httpApiSteps(store: JournalStoreStub): readonly string[] {
  return store.rows.map(
    (row) => (JSON.parse(row) as { rec: { label: string } }).rec.label,
  );
}

/** A released ticket, which the drive has already dispatched, so its work task is running. */
async function httpApiWorking(
  wired: HttpApiWiring,
  wrapUp = "WNone",
): Promise<void> {
  await httpApiAdmit(wired.registry);
  await wired.route(
    await httpApiSigned("author", httpApiArrives("a ticket", wrapUp)),
  );
  await wired.route(
    await httpApiSigned("author", {
      path: "/api/tickets/1/release",
      ...httpApiPosts({}),
    }),
  );
}

/** The declaration a case posts when the body itself is not what it is asking about. */
const httpApiNothing: CompletionDeclaration = {
  verdict: "VPass",
  artifact: { body: "BNone" },
};

/** The body a case expects to read back, as the store answers it. */
function httpApiKept(body: ArtifactBody): unknown {
  return { parsed: "Ok", value: body };
}

test("a completion is admitted by the token minted for that task and by nothing else", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiWorking(wired);
  const wrong = [
    "",
    "not-a-token",
    httpApiJobToken(1, 2),
    httpApiJobTokenMint("some-other-secret")(asTicketId(1), asTaskId(1)),
  ];
  for (const token of wrong) {
    const answer = await wired.route(
      httpApiAsk(httpApiCompletes(1, 1, httpApiNothing, token)),
    );
    assert.equal(answer.status, 401, token);
  }
  const none = await wired.route(
    httpApiAsk({
      path: "/internal/tasks/1/1/completion",
      ...httpApiPosts(httpApiNothing),
    }),
  );
  assert.equal(none.status, 401);
  assert.deepEqual(httpApiSteps(wired.store), [
    "ticket-arrived",
    "ticket-released",
    "dispatch",
  ]);
  assert.equal(
    await wired.artifacts.read(asTicketId(1), asTaskId(1)),
    undefined,
  );
  const held = await wired.route(
    httpApiAsk(httpApiCompletes(1, 1, httpApiNothing, httpApiJobToken(1, 1))),
  );
  assert.equal(held.status, 200);
});

test("a declaration the vocabulary does not describe is refused, and nothing is kept", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiWorking(wired);
  const answer = await wired.route(
    httpApiAsk({
      path: "/internal/tasks/1/1/completion",
      authorization: `Bearer ${httpApiJobToken(1, 1)}`,
      ...httpApiPosts({ verdict: "VPass" }),
    }),
  );
  assert.equal(answer.status, 400);
  assert.equal(httpApiRead(answer.body)["refused"], "not a declaration");
  assert.match(String(httpApiRead(answer.body)["why"]), /artifact/);
  assert.deepEqual(httpApiSteps(wired.store), [
    "ticket-arrived",
    "ticket-released",
    "dispatch",
  ]);
  assert.equal(
    await wired.artifacts.read(asTicketId(1), asTaskId(1)),
    undefined,
  );
});

test("a job's completion is journaled and its body is readable back over the socket", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiWorking(wired);
  const base = await httpApiListening(t, httpApi(wired.desk));
  const token = httpApiJobToken(1, 1);
  const branch = workBranch(asTicketId(1), asTaskId(1));
  const posted = await fetch(`${base}/internal/tasks/1/1/completion`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      verdict: "VPass",
      artifact: { body: "BGitRef", branch },
    }),
  });
  assert.equal(posted.status, 200);
  assert.equal(((await posted.json()) as Record<string, unknown>)["seq"], 4);
  assert.ok(httpApiSteps(wired.store).includes("task-done"));
  const read = await fetch(`${base}/api/artifacts/1/1`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(read.status, 200);
  assert.deepEqual(
    ((await read.json()) as Record<string, unknown>)["artifact"],
    {
      body: "BGitRef",
      branch,
    },
  );
});

test("the artifact is kept even when the decision that was to follow it never lands", async (t) => {
  const wired = httpApiWiring(t, undefined, (driven) => ({
    ...driven,
    taskDone: () => Promise.reject(new Error("the decision was cut off")),
  }));
  await httpApiWorking(wired);
  const declared: ArtifactBody = { body: "BNote", text: "half a write" };
  await assert.rejects(
    wired.route(
      httpApiAsk(
        httpApiCompletes(
          1,
          1,
          { verdict: "VPass", artifact: declared },
          httpApiJobToken(1, 1),
        ),
      ),
    ),
  );
  assert.ok(!httpApiSteps(wired.store).includes("task-done"));
  assert.deepEqual(
    await wired.artifacts.read(asTicketId(1), asTaskId(1)),
    httpApiKept(declared),
  );
});

test("a second declaration for one task is journaled as a duplicate and leaves the first body", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiWorking(wired);
  const token = httpApiJobToken(1, 1);
  const first: ArtifactBody = { body: "BNote", text: "the first word" };
  const opened = await wired.route(
    httpApiAsk(
      httpApiCompletes(1, 1, { verdict: "VPass", artifact: first }, token),
    ),
  );
  assert.equal(opened.status, 200);
  const again = await wired.route(
    httpApiAsk(
      httpApiCompletes(
        1,
        1,
        { verdict: "VFail", artifact: { body: "BNote", text: "the second" } },
        token,
      ),
    ),
  );
  assert.equal(again.status, 200);
  assert.equal(httpApiRead(again.body)["seq"], 6);
  assert.deepEqual(httpApiSteps(wired.store), [
    "ticket-arrived",
    "ticket-released",
    "dispatch",
    "task-done",
    "work-passed",
    "task-done-duplicate",
  ]);
  assert.deepEqual(
    await wired.artifacts.read(asTicketId(1), asTaskId(1)),
    httpApiKept(first),
  );
});

test("a completion for a revoked ticket is answered rather than refused, and its body is still kept", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiWorking(wired);
  await wired.route(
    await httpApiSigned("author", {
      path: "/api/tickets/1/revoke",
      ...httpApiPosts({}),
    }),
  );
  const answer = await wired.route(
    httpApiAsk(httpApiCompletes(1, 1, httpApiNothing, httpApiJobToken(1, 1))),
  );
  assert.equal(answer.status, 200);
  assert.match(String(httpApiRead(answer.body)["dropped"]), /JTaskDone/);
  assert.deepEqual(httpApiSteps(wired.store), [
    "ticket-arrived",
    "ticket-released",
    "dispatch",
    "ticket-revoked",
  ]);
  assert.deepEqual(
    await wired.artifacts.read(asTicketId(1), asTaskId(1)),
    httpApiKept(httpApiNothing.artifact),
  );
});

test("an artifact is read by an admitted person or by one of that ticket's jobs, and by nobody else", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiWorking(wired);
  await wired.route(
    httpApiAsk(httpApiCompletes(1, 1, httpApiNothing, httpApiJobToken(1, 1))),
  );
  const person = await wired.route(
    await httpApiSigned("author", { path: "/api/artifacts/1/1" }),
  );
  assert.equal(person.status, 200);
  const evaluator = await wired.route(
    httpApiAsk({
      path: "/api/artifacts/1/1",
      authorization: `Bearer ${httpApiJobToken(1, 2)}`,
    }),
  );
  assert.equal(evaluator.status, 200);
  const stranger = await wired.route(
    httpApiAsk({
      path: "/api/artifacts/1/1",
      authorization: `Bearer ${httpApiJobToken(2, 1)}`,
    }),
  );
  assert.equal(stranger.status, 401);
  const absent = await wired.route(
    await httpApiSigned("author", { path: "/api/artifacts/1/2" }),
  );
  assert.equal(absent.status, 404);
});

test("a typed artifact carries a ticket from arrival through work into evaluation", async (t) => {
  const wired = httpApiWiring(t);
  await httpApiWorking(wired, "WExclusive:1");
  const base = await httpApiListening(t, httpApi(wired.desk));
  const branch = workBranch(asTicketId(1), asTaskId(1));
  const complete = (task: number, artifact: ArtifactBody): Promise<Response> =>
    fetch(`${base}/internal/tasks/1/${String(task)}/completion`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${httpApiJobToken(1, task)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ verdict: "VPass", artifact }),
    });
  assert.equal((await complete(1, { body: "BGitRef", branch })).status, 200);
  assert.equal((await complete(2, { body: "BNone" })).status, 200);
  assert.deepEqual(httpApiSteps(wired.store), [
    "ticket-arrived",
    "ticket-released",
    "dispatch",
    "task-done",
    "work-passed",
    "task-done",
    "eval-passed",
    "wrapup-started",
  ]);
  const token = await httpApiToken({ subject: "author" });
  const view = await fetch(`${base}/api/tickets/1`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const held = (await view.json()) as { ticket: { declared: unknown } };
  assert.deepEqual(held.ticket.declared, [
    { task: 1, body: { body: "BGitRef", branch } },
    { task: 2, body: { body: "BNone" } },
  ]);
});

test("the artifact store round-trips the vocabulary and refuses a row it would never have written", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => {
    database.close();
  });
  const artifacts = httpApiArtifacts(database);
  const bodies: readonly ArtifactBody[] = [
    { body: "BGitRef", branch: workBranch(asTicketId(1), asTaskId(1)) },
    { body: "BNote", text: "what the evaluation read" },
    { body: "BNone" },
  ];
  for (let at = 0; at < bodies.length; at++) {
    const body = bodies[at];
    if (body === undefined) throw new Error("the case named a body it has not");
    await artifacts.write(asTicketId(1), asTaskId(at + 1), body);
  }
  assert.deepEqual(await artifacts.forTicket(asTicketId(1)), {
    parsed: "Ok",
    value: bodies.map((body, at) => ({ task: at + 1, body })),
  });
  assert.throws(() =>
    database.exec(
      "INSERT INTO artifacts (ticket, task, kind, payload) VALUES (2, 1, 'BTarball', 'x')",
    ),
  );
  database.exec("UPDATE artifacts SET payload = '' WHERE task = 1");
  const tampered = await artifacts.read(asTicketId(1), asTaskId(1));
  assert.equal(tampered?.parsed, "Refused");
});
