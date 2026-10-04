/**
 * The API command's authentication, which is two bearer kinds and one door.
 *
 * IT IS DRIVEN AS A PROCESS BECAUSE NOTHING MAY IMPORT ONE. `src/roots/` is the
 * graph's executable roots and `.dependency-cruiser.cjs` forbids importing one,
 * so the composition is reached in a child process of its own.
 *
 * WHAT IS UNDER TEST IS THE ROOT'S WIRING, not the routing rule beneath it:
 * `../adapters/sessionBearer.test.ts` owns the rule, and this asks only whether
 * this deployment put the session authority behind the door at all — a
 * composition that named only the issuer would answer a live session bearer
 * `InvalidToken` and look exactly like a bad token.
 *
 * EVERY DOUBLE RECORDS THAT IT WAS ASKED, and the two pools are told apart, so
 * a case can require both that neither authority is offered the other's token
 * and that the session authority stands on the API pool. Only that pool holds
 * `EXECUTE` on `authenticate_session_bearer`; over the selector review pool
 * every session bearer would be a 503 on a healthy deployment, and a double
 * that answered both pools alike could not see the difference.
 *
 * THE LEAD'S READ SIDE IS HELD TO THE SAME POOL FOR THE SAME REASON. Only the
 * API role holds `EXECUTE` on 059's definer functions, so a lead port wired to
 * the review pool answers all five lead routes 500 on a healthy deployment —
 * which no other gate can see, because nothing may import a root.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

import { threadLiveLimitsDefault } from "../../src/interpreter/threadLive.ts";

const execute = promisify(execFile);

const issuer = "https://auth.invalid";
const subject = "lead";
const principal = `${String(issuer.length)}:${issuer}${subject}`;

/** A bearer of the session language, which is the prefix and two hyphenated uuids. */
const sessionToken = `chgs_${"a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d".repeat(2)}`;

/** A compact JWS, whose first bytes are the base64url of `{"alg`, so it is the issuer's. */
const issuerToken = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJsZWFkIn0.c2ln";

/**
 * The root's own composition against a pool that answers one row and an issuer
 * that answers one principal, each recording what it was handed.
 */
function authenticationProgram(token: string): string {
  return `
    const root = await import('./src/roots/nativeHttp.ts');
    const asked = { pool: [], selectorReviewPool: [], oidc: [] };
    const pooled = (named, principal) => ({
      query: async (statement) => {
        asked[named].push(statement.values);
        return { rows: [{
          tenant: 'tenant', project: 'project', session: 'session-' + named,
          kind: 'Lead', principal,
        }] };
      },
    });
    const pools = {
      pool: pooled('pool', ${JSON.stringify(principal)}),
      selectorReviewPool: pooled('selectorReviewPool', 'a review-pool principal'),
    };
    const oidc = {
      authenticateBearer: async (offered) => {
        asked.oidc.push(offered);
        return { authenticated: 'Bearer', bearer: { principal: 'the issuer\\'s' } };
      },
    };
    const authenticated = await root
      .nativeAuthentication(oidc, pools)
      .authenticateBearer(${JSON.stringify(token)});
    process.stdout.write(JSON.stringify({ authenticated, asked }));
  `;
}

/** What one authenticated token resolved to, and which authority was asked for it. */
interface Authenticated {
  readonly authenticated: {
    readonly authenticated: string;
    readonly bearer?: {
      readonly principal: string;
      readonly viaSession?: {
        readonly session: string;
        readonly partition: {
          readonly tenant: string;
          readonly project: string;
        };
      };
    };
  };
  readonly asked: {
    readonly pool: readonly (readonly string[])[];
    readonly selectorReviewPool: readonly (readonly string[])[];
    readonly oidc: readonly string[];
  };
}

/**
 * The root's own lead composition against two pools that answer no rows, each
 * recording the statements it was handed.
 */
const leadPortsProgram = `
  const root = await import('./src/roots/nativeHttp.ts');
  const asked = { pool: [], selectorReviewPool: [] };
  const pooled = (named) => ({
    query: async (statement) => {
      asked[named].push(statement.text ?? String(statement));
      return { rows: [] };
    },
  });
  const pools = {
    pool: pooled('pool'),
    selectorReviewPool: pooled('selectorReviewPool'),
  };
  const ports = root.nativeLeadPorts(pools, {
    readBatch: async () => ({ read: 'NotFound' }),
  });
  const partition = { tenant: 'tenant', project: 'project' };
  await ports.leads.standing(partition, 1);
  await ports.leads.streams(partition, 'session', 1);
  await ports.leads.batches({
    partition,
    session: 'session',
    stream: 'stream',
    after: 0,
    limit: 1,
  });
  await ports.history.history(partition, { limit: 1, order: 'oldest' });
  await ports.refusals.standing(partition, 1);
  await ports.refusals.ledger(partition, 1, 1);
  process.stdout.write(JSON.stringify(asked));
`;

/** Which pool each of the lead reads was handed, and what it was asked. */
interface LeadPortsAsked {
  readonly pool: readonly string[];
  readonly selectorReviewPool: readonly string[];
}

async function leadPortsAsked(): Promise<LeadPortsAsked> {
  const ran = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      leadPortsProgram,
    ],
    { cwd: process.cwd() },
  );
  return JSON.parse(ran.stdout) as LeadPortsAsked;
}

test("the lead's reads stand on the API pool and never the review pool", async () => {
  const asked = await leadPortsAsked();
  assert.deepEqual(
    asked.selectorReviewPool,
    [],
    "no lead read may reach the pool with no grant on 059's doors",
  );
  assert.equal(asked.pool.length, 6, "every lead read was handed the API pool");
});

test("each lead read reaches the definer function the plan names for it", async () => {
  const asked = await leadPortsAsked();
  for (const named of [
    "read_lead_standing",
    "list_session_store_streams",
    "read_session_store_batches",
    "read_selector_interactions",
    "read_standing_agentic_refusals",
    "read_agentic_refusals",
  ])
    assert.ok(
      asked.pool.some((statement) => statement.includes(named)),
      `${named} was reached over the API pool`,
    );
});

/**
 * The root's own thread composition, over one pool that answers no rows. The
 * credential slot is read from the environment because it is what a member's
 * thread speaks through, and a default would open every member's thread on
 * whatever the lead happens to use while reading as though somebody chose it.
 */
const threadPortsProgram = `
  const root = await import('./src/roots/nativeHttp.ts');
  const asked = { pool: [], selectorReviewPool: [] };
  const pooled = (named) => ({
    query: async (statement) => {
      asked[named].push(statement.text ?? String(statement));
      return { rows: [] };
    },
  });
  const pools = {
    pool: pooled('pool'),
    selectorReviewPool: pooled('selectorReviewPool'),
  };
  const ports = root.nativeThreadPorts(pools, {
    readBatch: async () => ({ read: 'NotFound' }),
  });
  const partition = { tenant: 'tenant', project: 'project' };
  await ports.threads.threads(partition, 1);
  await ports.seeding.projectTexts(partition);
  await ports.rows.batches({
    partition,
    session: 'session',
    stream: 'stream',
    after: 0,
    limit: 1,
  });
  process.stdout.write(JSON.stringify({
    asked,
    slot: ports.credentialSlot,
    minted: ports.sessions.session(),
  }));
`;

interface ThreadPortsComposed {
  readonly asked: {
    readonly pool: readonly string[];
    readonly selectorReviewPool: readonly string[];
  };
  readonly slot: string;
  readonly minted: string;
}

async function threadPortsComposed(
  slot: string | undefined,
): Promise<{ readonly code: number; readonly out: string }> {
  const environment = { ...process.env };
  if (slot === undefined) delete environment["CHUG_API_THREAD_CREDENTIAL_SLOT"];
  else environment["CHUG_API_THREAD_CREDENTIAL_SLOT"] = slot;
  try {
    const ran = await execute(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        threadPortsProgram,
      ],
      { cwd: process.cwd(), env: environment },
    );
    return { code: 0, out: ran.stdout };
  } catch (failure) {
    const ran = failure as { code?: number; stderr?: string };
    return { code: ran.code ?? 1, out: ran.stderr ?? "" };
  }
}

test("the thread bundle the root composes reaches 062's own reads", async () => {
  const ran = await threadPortsComposed("claude-code");
  assert.equal(ran.code, 0, ran.out);
  const composed = JSON.parse(ran.out) as ThreadPortsComposed;
  for (const named of [
    "read_project_threads",
    "selector_project_settings",
    "read_session_store_batches",
  ])
    assert.ok(
      composed.asked.pool.some((statement) => statement.includes(named)),
      `${named} was reached over the API pool`,
    );
  assert.deepEqual(
    composed.asked.selectorReviewPool,
    [],
    "no thread read may reach the pool with no grant on 062's doors",
  );
  assert.equal(composed.slot, "claude-code");
  assert.ok(composed.minted.startsWith("thread-"));
});

/**
 * The inquiry routes over the composition the root builds, driven against pools
 * that record what they were asked and place the lead in cluster: `nativeHttp.ts`
 * reaches its three doors and the session route through `composeNativeWeb` and
 * passes no bundle for them, because there is nothing about an inquiry for a
 * deployment to choose, so what a case can observe is which pool the
 * composition reached and that it reached one at all. The doors' own answers
 * are `test/postgres/inquiryHttpDoors.test.ts`'s.
 */
const inquiryComposedProgram = `
  const compose = await import('./src/compose.ts');
  const asked = { pool: [], selectorReviewPool: [] };
  const pooled = (named) => ({
    query: async (statement) => {
      const text = statement.text ?? String(statement);
      asked[named].push(text);
      return {
        rows: text.includes('session_route')
          ? [{ route: 'InCluster', source: 'Default' }]
          : [],
      };
    },
  });
  const pool = pooled('pool');
  const web = compose.composeNativeWeb(
    pool,
    { digest: () => 'digest' },
    {
      authorize: async () => ({ kind: 'OidcUser', subject: 'geoff' }),
      authorizeTenant: async () => ({ kind: 'OidcUser', subject: 'geoff' }),
    },
    { admits: async () => ({ admitted: 'Admitted' }) },
  );
  const principal = 'principal';
  const partition = { tenant: 'tenant', project: 'project' };
  await web.leadInquiries(principal, partition);
  await web.leadInquiry(principal, partition, 'inq-one');
  await web
    .askLead(principal, partition, {
      session: 'inq-one',
      turn: 'inq-turn-one',
      question: 'what stopped ticket 14?',
    })
    .catch(() => undefined);
  process.stdout.write(JSON.stringify(asked));
`;

/**
 * A boundary composed without an inquiry store answers `500` on three routes in
 * a deployment while every gate stays green. This case is what makes that
 * impossible to reintroduce: the composition is driven rather than described,
 * and each door names its own definer.
 */
test("the composition the root builds reaches 063's own doors, over the API pool", async () => {
  const ran = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      inquiryComposedProgram,
    ],
    { cwd: process.cwd() },
  );
  const composed = JSON.parse(ran.stdout) as LeadPortsAsked;
  for (const named of [
    "read_lead_inquiries",
    "read_lead_inquiry",
    "session_route",
    "open_lead_inquiry",
  ])
    assert.ok(
      composed.pool.some((statement) => statement.includes(named)),
      `${named} was reached over the API pool`,
    );
  assert.deepEqual(
    composed.selectorReviewPool,
    [],
    "an inquiry was read through a pool that holds no grant on it",
  );
});

test("a deployment that names no credential slot for a thread is refused", async () => {
  const ran = await threadPortsComposed(undefined);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /CHUG_API_THREAD_CREDENTIAL_SLOT/u);
});

const forgeOptionsProgram = `
  const root = await import('./src/roots/nativeHttp.ts');
  const forge = await import('./src/adapters/forge/githubInstallationTokens.ts');
  const key = root.forgePortalKey();
  process.stdout.write(JSON.stringify(
    key === undefined ? null : forge.githubInstallationTokensOptions(key)));
`;

const forgePairsProgram = `
  const root = await import('./src/roots/nativeHttp.ts');
  process.stdout.write(JSON.stringify(root.forgeAppPairs().map((pair) => ({
    app: pair.app,
    appId: pair.key.appId,
    keyFile: pair.key.keyFile,
  }))));
`;

/** Every bound of the thread live stream under its own variable, each a value no other bound and no default holds. */
const threadLiveNamed = {
  CHUG_API_THREAD_LIVE_CONNECTIONS_MAX: "11",
  CHUG_API_THREAD_LIVE_SESSION_READERS_MAX: "12",
  CHUG_API_THREAD_LIVE_MAX_AGE_MS: "13",
  CHUG_API_THREAD_LIVE_HEARTBEAT_MS: "14",
  CHUG_API_THREAD_LIVE_SLOW_CLIENT_WAIT_MS: "15",
  CHUG_API_THREAD_LIVE_PENDING_BYTES_MAX: "16",
  CHUG_API_THREAD_LIVE_SESSIONS_HELD_MAX: "17",
  CHUG_API_THREAD_LIVE_HELD_BYTES_MAX: "18",
  CHUG_API_THREAD_LIVE_SESSION_TEXT_BYTES_MAX: "19",
  CHUG_API_THREAD_LIVE_SESSION_IDLE_MS: "20",
  CHUG_API_THREAD_LIVE_WINDOW_MS: "21",
  CHUG_API_THREAD_LIVE_WINDOW_EVENTS_MAX: "22",
  CHUG_API_THREAD_LIVE_SENT_BYTES_MAX: "23",
};

/** What a root program prints under the variables one case names, and nothing else. */
async function rootRead(
  named: Readonly<Record<string, string>>,
  program: string = forgeOptionsProgram,
): Promise<{ readonly code: number; readonly out: string }> {
  const environment = { ...process.env, ...named };
  for (const variable of [
    "CHUG_API_FORGE_APP_ID",
    "CHUG_API_FORGE_APP_KEY_FILE",
    "CHUG_API_FORGE_WORKER_APP_ID",
    "CHUG_API_FORGE_WORKER_APP_KEY_FILE",
    "CHUG_API_FORGE_API_URL",
    "CHUG_API_FORGE_APP_CLIENT_SECRET_FILE",
    "CHUG_API_POOL_TOKEN_URL",
    "CHUG_API_POOL_PLANE_URL",
    "CHUG_API_POOL_REGISTRY_HOST",
    ...Object.keys(threadLiveNamed),
  ])
    if (named[variable] === undefined) delete environment[variable];
  try {
    const ran = await execute(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", program],
      { cwd: process.cwd(), env: environment },
    );
    return { code: 0, out: ran.stdout };
  } catch (failure) {
    const ran = failure as { code?: number; stderr?: string };
    return { code: ran.code ?? 1, out: ran.stderr ?? "" };
  }
}

const poolSiteProgram = `
  const root = await import('./src/roots/nativeHttp.ts');
  process.stdout.write(JSON.stringify(root.workerPoolSite()));
`;

/** Every address a pool file carries, as a runner would read it. */
const poolNamed = {
  CHUG_API_OIDC_ISSUER: "https://auth.chuggy.test/",
  CHUG_API_OIDC_AUDIENCE: "https://chuggy.test/api",
  CHUG_API_POOL_TOKEN_URL: "https://auth.chuggy.test/oauth2/token",
  CHUG_API_POOL_PLANE_URL: "http://127.0.0.1:4444",
  CHUG_API_POOL_REGISTRY_HOST: "chuggy-registry.chuggy.test:5000",
};

const threadLiveLimitsProgram = `
  const root = await import('./src/roots/nativeHttp.ts');
  process.stdout.write(JSON.stringify(root.nativeThreadLiveLimits()));
`;

test("each bound of the thread live stream is the one its own variable names, the hub's default where none does, and a refusal to start where it is not a count", async () => {
  const unnamed = await rootRead({}, threadLiveLimitsProgram);
  assert.equal(unnamed.code, 0, unnamed.out);
  assert.deepEqual(JSON.parse(unnamed.out), threadLiveLimitsDefault);
  const named = await rootRead(threadLiveNamed, threadLiveLimitsProgram);
  assert.equal(named.code, 0, named.out);
  assert.deepEqual(JSON.parse(named.out), {
    connectionsMax: 11,
    sessionReadersMax: 12,
    maxAgeMs: 13,
    heartbeatMs: 14,
    slowClientWaitMs: 15,
    pendingBytesMax: 16,
    sentBytesMax: 23,
    sessionsHeldMax: 17,
    heldBytesMax: 18,
    sessionTextBytesMax: 19,
    sessionIdleMs: 20,
    windowMs: 21,
    windowEventsMax: 22,
  });
  const refused = await rootRead(
    { CHUG_API_THREAD_LIVE_HEARTBEAT_MS: "0" },
    threadLiveLimitsProgram,
  );
  assert.equal(refused.code, 1);
  assert.match(
    refused.out,
    /CHUG_API_THREAD_LIVE_HEARTBEAT_MS must be a positive integer/u,
  );
});

/**
 * The root's stopping wired to an app that serves nothing, two hubs and two
 * pools that each record being closed, then stopped as `stop` stops it. What
 * was closed is printed once the last pool has been.
 */
function stoppingProgram(stop: string): string {
  return `
  const root = await import('./src/roots/nativeHttp.ts');
  const { default: fastify } = await import('fastify');
  const closed = [];
  const recording = (name, close) => ({
    [close]: () => {
      closed.push(name);
      return Promise.resolve();
    },
  });
  const app = fastify();
  root.nativeStopping(
    app,
    { pool: recording('pool', 'end'), selectorReviewPool: recording('review pool', 'end') },
    [recording('project stream', 'close'), recording('thread live', 'close')],
  );
  const asking = setInterval(() => {
    if (!closed.includes('review pool')) return;
    clearInterval(asking);
    process.stdout.write(JSON.stringify(closed));
  }, 10);
  await app.ready();
  ${stop}
`;
}

test("the app closing closes every hub it was stopped with and then the pools, and a stop signal closes the hubs before the drain begins", async () => {
  const hubs = ["project stream", "thread live"];
  const pools = ["pool", "review pool"];
  const closed = await rootRead({}, stoppingProgram("await app.close();"));
  assert.equal(closed.code, 0, closed.out);
  assert.deepEqual(JSON.parse(closed.out), [...hubs, ...pools]);
  const signalled = await rootRead(
    {},
    stoppingProgram("process.kill(process.pid, 'SIGTERM');"),
  );
  assert.equal(signalled.code, 0, signalled.out);
  assert.deepEqual(JSON.parse(signalled.out), [...hubs, ...hubs, ...pools]);
});

/**
 * Both hubs' reports as the root composes them, each written to as its hub
 * writes to it, under a clock the program sets. What `noting` leaves in `out`
 * is printed, and `written()` is what has reached the error stream since it
 * was last asked.
 */
function notesProgram(noting: string): string {
  return `
  const root = await import('./src/roots/nativeHttp.ts');
  let nowMs = 0;
  Date.now = () => nowMs;
  const lines = [];
  process.stderr.write = (line) => {
    lines.push(line.trimEnd());
    return true;
  };
  const written = () => lines.splice(0);
  const live = root.nativeThreadLiveReport();
  const stream = root.nativeStreamReport();
  const liveNote = (note) => ({
    ...note, connectionsOpen: 0, sessionsHeld: 0, heldBytes: 0, pendingBytes: 0,
    sentBytes: 0, eventsHeard: 0, payloadsUnread: 0, payloadsShed: 0,
  });
  const streamNote = (note) => ({ ...note, streamsOpen: 0, rowsRead: 0 });
  const out = {};
  ${noting}
  process.stdout.write(JSON.stringify(out));
`;
}

/** How many of its kind each line says there have been, in the order the lines were written. */
function timesSaid(lines: readonly string[]): number[] {
  return lines.map((line) => Number(/ times=(\d+)$/u.exec(line)?.[1]));
}

test("a note a client causes is written at the first of a run and at each that doubles it, with how many of its kind there have been, each kind of each hub counted apart", async () => {
  const ran = await rootRead(
    {},
    notesProgram(`
      const kinds = [
        ['live Refused', live, liveNote({ note: 'Refused' })],
        ['live SlowClientClosed', live, liveNote({ note: 'SlowClientClosed' })],
        ['live PendingClosed', live, liveNote({ note: 'PendingClosed' })],
        ['live SentClosed', live, liveNote({ note: 'SentClosed' })],
        ['stream Refused', stream, streamNote({ note: 'Refused' })],
        ['stream SlowClientClosed', stream, streamNote({ note: 'SlowClientClosed' })],
      ];
      for (const [kind] of kinds) out[kind] = [];
      for (let round = 0; round < 1000; round += 1)
        for (const [kind, report, note] of kinds) {
          report.noted(note);
          out[kind].push(...written());
        }
    `),
  );
  assert.equal(ran.code, 0, ran.out);
  const written = JSON.parse(ran.out) as Record<string, string[]>;
  assert.equal(Object.keys(written).length, 6);
  for (const [kind, lines] of Object.entries(written)) {
    assert.deepEqual(
      timesSaid(lines),
      [1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
      kind,
    );
    const hub = kind.startsWith("live") ? "thread live: " : "project stream: ";
    assert.ok(
      lines.every((line) => line.startsWith(hub)),
      kind,
    );
  }
});

test("the hubs this root composes report as these do: what a stopped hub refuses is written at the first and at each that doubles it", async () => {
  const ran = await rootRead(
    { CHUG_API_DATABASE_URL: "postgres://nobody@127.0.0.1:1/nothing" },
    notesProgram(`
      const liveHub = root.nativeThreadLiveHub();
      const streamHub = root.nativeStreamHub({}, {});
      await liveHub.close();
      await streamHub.close();
      const partition = { tenant: 'tenant', project: 'project' };
      for (let round = 0; round < 8; round += 1) {
        liveHub.open({ partition, session: 'thread-1', admitted: () => Promise.resolve(true) });
        await streamHub.open({ partition, principal: 'issuer-subject' });
      }
      out.lines = written().filter((line) => line.includes(': refused a '));
    `),
  );
  assert.equal(ran.code, 0, ran.out);
  const { lines } = JSON.parse(ran.out) as { lines: string[] };
  for (const hub of ["thread live: ", "project stream: "])
    assert.deepEqual(
      timesSaid(lines.filter((line) => line.startsWith(hub))),
      [1, 2, 4, 8],
      hub,
    );
  assert.equal(lines.length, 8);
});

test("a note this process paces is written every time it is noted, and says nothing of how many", async () => {
  const ran = await rootRead(
    {},
    notesProgram(`
      for (let round = 0; round < 5; round += 1) {
        live.noted(liveNote({ note: 'Sourced', source: 'Lost' }));
        live.noted(liveNote({ note: 'Unread' }));
        live.noted(liveNote({ note: 'Shed' }));
        stream.noted(streamNote({ note: 'Sourced', state: 'lost' }));
        stream.noted(streamNote({ note: 'Swept', removed: 3 }));
        stream.noted(streamNote({ note: 'ReadFailed', failure: 'refused' }));
      }
      out.lines = written();
    `),
  );
  assert.equal(ran.code, 0, ran.out);
  const { lines } = JSON.parse(ran.out) as { lines: string[] };
  assert.equal(lines.length, 30);
  assert.equal(new Set(lines).size, 6);
  assert.ok(lines.every((line) => !line.includes("times=")));
});

test("a run goes on while each of its notes comes within the quiet span of the last, a kind unheard for that span begins its run again, and its lines go on saying how many there have been in all", async () => {
  const ran = await rootRead(
    {},
    notesProgram(`
      const cut = liveNote({ note: 'SentClosed' });
      for (let round = 0; round < 5; round += 1) live.noted(cut);
      for (let round = 0; round < 2; round += 1) {
        nowMs += root.nativeNoteQuietMs - 1;
        live.noted(cut);
      }
      for (let round = 0; round < 3; round += 1) live.noted(cut);
      out.short = written();
      nowMs += root.nativeNoteQuietMs;
      for (let round = 0; round < 4; round += 1) live.noted(cut);
      out.quiet = written();
    `),
  );
  assert.equal(ran.code, 0, ran.out);
  const written = JSON.parse(ran.out) as { short: string[]; quiet: string[] };
  assert.deepEqual(timesSaid(written.short), [1, 2, 4, 7, 8]);
  assert.deepEqual(timesSaid(written.quiet), [11, 12, 14]);
});

test("a kind still arriving is written once the quiet span has passed since its last line, and its run is not begun again for it: a trickle says its count each span, and a surge inside it is said within one", async () => {
  const ran = await rootRead(
    {},
    notesProgram(`
      const refused = liveNote({ note: 'Refused' });
      for (let round = 0; round < 40; round += 1) {
        nowMs += root.nativeNoteQuietMs * 5 / 6;
        live.noted(refused);
      }
      out.trickle = written();
      for (let round = 0; round < 20; round += 1) {
        nowMs += 1;
        live.noted(refused);
      }
      nowMs += root.nativeNoteQuietMs - 21;
      live.noted(refused);
      out.surge = written();
      nowMs += 1;
      for (let round = 0; round < 3; round += 1) live.noted(refused);
      out.span = written();
    `),
  );
  assert.equal(ran.code, 0, ran.out);
  const written = JSON.parse(ran.out) as {
    trickle: string[];
    surge: string[];
    span: string[];
  };
  assert.deepEqual(timesSaid(written.trickle), [
    1,
    ...Array.from({ length: 20 }, (_unused, at) => 2 * (at + 1)),
  ]);
  assert.deepEqual(written.surge, []);
  assert.deepEqual(timesSaid(written.span), [62, 64]);
});

test("a kind arriving far oftener than the quiet span is written at each doubling of its run and otherwise once a span, and no oftener", async () => {
  const ran = await rootRead(
    {},
    notesProgram(`
      const cut = liveNote({ note: 'SentClosed' });
      for (let round = 0; round < 1000; round += 1) {
        nowMs += root.nativeNoteQuietMs / 100;
        live.noted(cut);
      }
      out.lines = written();
    `),
  );
  assert.equal(ran.code, 0, ran.out);
  const { lines } = JSON.parse(ran.out) as { lines: string[] };
  assert.deepEqual(
    timesSaid(lines),
    [1, 2, 4, 8, 16, 32, 64, 128, 228, 256, 356, 456, 512, 612, 712, 812, 912],
  );
});

test("a pool site a runner would read is composed as named", async () => {
  const ran = await rootRead(poolNamed, poolSiteProgram);
  assert.equal(ran.code, 0, ran.out);
  assert.deepEqual(JSON.parse(ran.out), {
    issuer: "https://auth.chuggy.test/",
    tokenUrl: "https://auth.chuggy.test/oauth2/token",
    audience: "https://chuggy.test/api",
    planeUrl: "http://127.0.0.1:4444/",
    registryHost: "chuggy-registry.chuggy.test:5000",
  });
});

test("a pool address a runner would refuse is a refusal to start", async () => {
  for (const [variable, value] of [
    ["CHUG_API_POOL_TOKEN_URL", "http://auth.chuggy.test/oauth2/token"],
    ["CHUG_API_POOL_TOKEN_URL", "not a url"],
    ["CHUG_API_POOL_PLANE_URL", "ftp://plane.chuggy.test/"],
    ["CHUG_API_POOL_PLANE_URL", "http://plane.chuggy.test/"],
    ["CHUG_API_POOL_PLANE_URL", "https://op:pw-fixture@plane.chuggy.test/"],
    ["CHUG_API_POOL_TOKEN_URL", "https://op@auth.chuggy.test/oauth2/token"],
  ] as const) {
    const ran = await rootRead(
      { ...poolNamed, [variable]: value },
      poolSiteProgram,
    );
    assert.equal(ran.code, 1, `${variable}=${value}`);
    assert.match(ran.out, new RegExp(`${variable} must be an https URL`, "u"));
    assert.doesNotMatch(ran.out, /pw-fixture/u);
  }
});

test("a registry host a runner would refuse is a refusal to start, and none names no registry", async () => {
  for (const host of [
    "https://chuggy-registry.chuggy.test",
    "Chuggy-Registry.chuggy.test",
    "chuggy-registry.chuggy.test/path",
  ]) {
    const ran = await rootRead(
      { ...poolNamed, CHUG_API_POOL_REGISTRY_HOST: host },
      poolSiteProgram,
    );
    assert.equal(ran.code, 1, host);
    assert.match(
      ran.out,
      /CHUG_API_POOL_REGISTRY_HOST must be a lowercase host/u,
    );
  }
  const ran = await rootRead(
    { ...poolNamed, CHUG_API_POOL_REGISTRY_HOST: "" },
    poolSiteProgram,
  );
  assert.equal(ran.code, 0, ran.out);
  assert.equal(
    (JSON.parse(ran.out) as { registryHost?: string }).registryHost,
    undefined,
  );
});

test("a deployment naming no forge app mints nothing at all", async () => {
  const ran = await rootRead({});
  assert.equal(ran.code, 0, ran.out);
  assert.equal(JSON.parse(ran.out), null);
});

test("a deployment naming one of the app and its key is refused rather than started", async () => {
  for (const named of [
    { CHUG_API_FORGE_APP_ID: "4708055" },
    { CHUG_API_FORGE_APP_KEY_FILE: "/etc/chuggy/forge/portal.pem" },
  ]) {
    const ran = await rootRead(named);
    assert.equal(ran.code, 1, ran.out);
    assert.match(ran.out, /named together or not at all/u);
  }
});

test("a deployment naming both reaches the forge it named, or the public one", async () => {
  const named = {
    CHUG_API_FORGE_APP_ID: "4708055",
    CHUG_API_FORGE_APP_KEY_FILE: "/etc/chuggy/forge/portal.pem",
  };
  const composed = JSON.parse((await rootRead(named)).out) as {
    appId: string;
    privateKeyPath: string;
    apiUrl: string;
  };
  assert.equal(composed.appId, named.CHUG_API_FORGE_APP_ID);
  assert.equal(composed.privateKeyPath, named.CHUG_API_FORGE_APP_KEY_FILE);
  assert.equal(composed.apiUrl, "https://api.github.com");
  const elsewhere = JSON.parse(
    (
      await rootRead({
        ...named,
        CHUG_API_FORGE_API_URL: "https://forge.invalid",
      })
    ).out,
  ) as { apiUrl: string };
  assert.equal(elsewhere.apiUrl, "https://forge.invalid");
});

const workerNamed = {
  CHUG_API_FORGE_APP_ID: "4708055",
  CHUG_API_FORGE_APP_KEY_FILE: "/etc/chuggy/forge/portal.pem",
  CHUG_API_FORGE_WORKER_APP_ID: "4728465",
  CHUG_API_FORGE_WORKER_APP_KEY_FILE: "/etc/chuggy/forge/worker.pem",
};

/** What the root composed for one case: which apps, and the key pair each was named by. */
async function forgePairsRead(
  named: Readonly<Record<string, string>>,
): Promise<readonly { app: string; appId: string; keyFile: string }[]> {
  const ran = await rootRead(named, forgePairsProgram);
  assert.equal(ran.code, 0, ran.out);
  return JSON.parse(ran.out) as readonly {
    app: string;
    appId: string;
    keyFile: string;
  }[];
}

const forgeKeysProgram = `
  const root = await import('./src/roots/nativeHttp.ts');
  const unusable = await root.forgeKeysUnusable(root.forgeAppPairs());
  process.stdout.write(JSON.stringify(unusable ?? null));
`;

/**
 * A directory holding one key this process can sign with and one file that is
 * not a key, which is what a Secret mounted at the wrong path looks like.
 */
function forgeKeyFiles(t: TestContext): {
  readonly usable: string;
  readonly unusable: string;
} {
  const root = mkdtempSync(join(tmpdir(), "chuggy-root-forge-key-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const usable = join(root, "usable.pem");
  writeFileSync(
    usable,
    generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs1", format: "pem" })
      .toString(),
  );
  const unusable = join(root, "unusable.pem");
  writeFileSync(unusable, "this is a mounted Secret and not a private key\n");
  return { usable, unusable };
}

test("a key pair this process cannot sign with is a refusal to start", async (t) => {
  const keys = forgeKeyFiles(t);
  const both = {
    CHUG_API_FORGE_APP_ID: "4708055",
    CHUG_API_FORGE_APP_KEY_FILE: keys.usable,
    CHUG_API_FORGE_WORKER_APP_ID: "4728465",
    CHUG_API_FORGE_WORKER_APP_KEY_FILE: keys.usable,
  };
  const ready = await rootRead(both, forgeKeysProgram);
  assert.equal(ready.code, 0, ready.out);
  assert.equal(JSON.parse(ready.out), null);
  for (const [variable, named] of [
    [
      "CHUG_API_FORGE_WORKER_APP_KEY_FILE",
      {
        ...both,
        CHUG_API_FORGE_WORKER_APP_KEY_FILE: keys.unusable,
      },
    ],
    [
      "CHUG_API_FORGE_APP_KEY_FILE",
      {
        ...both,
        CHUG_API_FORGE_APP_KEY_FILE: keys.unusable,
      },
    ],
  ] as const) {
    const ran = await rootRead(named, forgeKeysProgram);
    assert.equal(ran.code, 0, ran.out);
    assert.match(JSON.parse(ran.out) as string, new RegExp(variable, "u"));
  }
});

test("the worker app is its own pair, optional, and composed beside the portal's", async () => {
  assert.deepEqual(await forgePairsRead({}), []);
  const half = await rootRead(
    { CHUG_API_FORGE_WORKER_APP_ID: "4728465" },
    forgePairsProgram,
  );
  assert.equal(half.code, 1, half.out);
  assert.match(half.out, /CHUG_API_FORGE_WORKER_APP_KEY_FILE/u);
  const both = await forgePairsRead(workerNamed);
  assert.deepEqual(
    both.map((pair) => pair.app),
    ["portal", "worker"],
  );
  assert.equal(both[1]?.appId, workerNamed.CHUG_API_FORGE_WORKER_APP_ID);
  assert.equal(
    both[1]?.keyFile,
    workerNamed.CHUG_API_FORGE_WORKER_APP_KEY_FILE,
  );
  const portalOnly = await forgePairsRead({
    CHUG_API_FORGE_APP_ID: workerNamed.CHUG_API_FORGE_APP_ID,
    CHUG_API_FORGE_APP_KEY_FILE: workerNamed.CHUG_API_FORGE_APP_KEY_FILE,
  });
  assert.deepEqual(
    portalOnly.map((pair) => pair.app),
    ["portal"],
  );
});

const forgeSecretProgram = `
  const root = await import('./src/roots/nativeHttp.ts');
  const setting = await root.forgeClientSecretSetting(root.forgePortalKey());
  process.stdout.write(JSON.stringify({
    setting: setting.setting,
    path: setting.path,
    why: setting.why,
  }));
`;

/** What the root decided about the client secret under the variables one case names. */
async function forgeSecretRead(
  named: Readonly<Record<string, string>>,
): Promise<{ setting: string; path?: string; why?: string }> {
  const ran = await rootRead(named, forgeSecretProgram);
  assert.equal(ran.code, 0, ran.out);
  return JSON.parse(ran.out) as {
    setting: string;
    path?: string;
    why?: string;
  };
}

/** A mounted secret, one that is not there, one holding only a newline, and one that is a directory. */
function forgeSecretFiles(t: TestContext): {
  readonly present: string;
  readonly missing: string;
  readonly empty: string;
  readonly unreadable: string;
} {
  const root = mkdtempSync(join(tmpdir(), "chuggy-root-forge-secret-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const present = join(root, "client-secret");
  writeFileSync(present, "a-client-secret\n");
  const empty = join(root, "empty");
  writeFileSync(empty, "\n");
  const unreadable = join(root, "directory");
  mkdirSync(unreadable);
  return { present, missing: join(root, "missing"), empty, unreadable };
}

/**
 * The secret's Secret is optional on the rig, so a file that is not there — or
 * holds nothing but the newline a mount leaves — is a deployment that cannot
 * redeem an authorization and starts anyway; one it cannot read, or one named
 * with no portal key to redeem beside, refuses the start.
 */
test("a client secret that is not there starts without redemption, and one that cannot be used refuses the start", async (t) => {
  const files = forgeSecretFiles(t);
  const portal = {
    CHUG_API_FORGE_APP_ID: "4708055",
    CHUG_API_FORGE_APP_KEY_FILE: "/etc/chuggy/forge/portal.pem",
  };
  const secret = "CHUG_API_FORGE_APP_CLIENT_SECRET_FILE";
  assert.deepEqual(await forgeSecretRead(portal), { setting: "Absent" });
  for (const absent of [files.missing, files.empty])
    assert.deepEqual(
      await forgeSecretRead({ ...portal, [secret]: absent }),
      { setting: "Absent" },
      absent,
    );
  assert.deepEqual(
    await forgeSecretRead({ ...portal, [secret]: files.present }),
    { setting: "Named", path: files.present },
  );
  const unreadable = await forgeSecretRead({
    ...portal,
    [secret]: files.unreadable,
  });
  assert.equal(unreadable.setting, "Refused");
  assert.match(unreadable.why ?? "", /cannot be read/u);
  const alone = await forgeSecretRead({ [secret]: files.present });
  assert.equal(alone.setting, "Refused");
  assert.match(alone.why ?? "", /CHUG_API_FORGE_APP_ID/u);
});

async function authenticating(token: string): Promise<Authenticated> {
  const ran = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      authenticationProgram(token),
    ],
    { cwd: process.cwd() },
  );
  return JSON.parse(ran.stdout) as Authenticated;
}

test("a session bearer is answered by this deployment's own session authority", async () => {
  const found = await authenticating(sessionToken);
  assert.deepEqual(found.authenticated, {
    authenticated: "Bearer",
    bearer: {
      principal,
      viaSession: {
        session: "session-pool",
        partition: { tenant: "tenant", project: "project" },
      },
    },
  });
  assert.equal(found.asked.pool.length, 1);
  assert.deepEqual(found.asked.oidc, []);
});

test("the session authority stands on the API pool and never the review pool", async () => {
  const found = await authenticating(sessionToken);
  assert.deepEqual(found.asked.selectorReviewPool, []);
  assert.equal(found.asked.pool.length, 1);
  assert.equal(
    found.authenticated.bearer?.viaSession?.session,
    "session-pool",
    "the session bearer was answered by a pool that is not the API's",
  );
});

test("the session authority is asked for a digest and never for the secret", async () => {
  const found = await authenticating(sessionToken);
  const values = found.asked.pool[0] ?? [];
  assert.deepEqual(values.length, 1);
  assert.match(values[0] ?? "", /^[0-9a-f]{64}$/u);
});

test("a token of the issuer's language never reaches the session authority", async () => {
  const found = await authenticating(issuerToken);
  assert.deepEqual(found.authenticated, {
    authenticated: "Bearer",
    bearer: { principal: "the issuer's" },
  });
  assert.deepEqual(found.asked.oidc, [issuerToken]);
  assert.deepEqual(found.asked.pool, []);
  assert.deepEqual(found.asked.selectorReviewPool, []);
});
