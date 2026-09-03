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
import { test } from "node:test";
import { promisify } from "node:util";

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
      readonly viaSession?: string;
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
  await ports.leads.streams(partition, 1);
  await ports.leads.batches({ partition, stream: 'stream', after: 0, limit: 1 });
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
    "list_lead_store_streams",
    "read_lead_store",
    "read_selector_interactions",
    "read_standing_agentic_refusals",
    "read_agentic_refusals",
  ])
    assert.ok(
      asked.pool.some((statement) => statement.includes(named)),
      `${named} was reached over the API pool`,
    );
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
    bearer: { principal, viaSession: "session-pool" },
  });
  assert.equal(found.asked.pool.length, 1);
  assert.deepEqual(found.asked.oidc, []);
});

test("the session authority stands on the API pool and never the review pool", async () => {
  const found = await authenticating(sessionToken);
  assert.deepEqual(found.asked.selectorReviewPool, []);
  assert.equal(found.asked.pool.length, 1);
  assert.equal(
    found.authenticated.bearer?.viaSession,
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
