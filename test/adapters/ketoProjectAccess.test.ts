import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ketoProjectAccess,
  ketoReadiness,
} from "../../src/adapters/keto/projectAccess.ts";
import { ketoResponseBytesMax } from "../../src/adapters/keto/request.ts";
import {
  checkedProjectAccessSettings,
  memberAuthority,
  ProjectAccessUnavailable,
  projectAccessObject,
  projectAccessPermits,
} from "../../src/interpreter/projectAccess.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const settings = checkedProjectAccessSettings({
  readUrl: "http://keto.test:4466",
  requestTimeoutMs: 250,
});
const partition = {
  tenant: asTenantId("acme/co"),
  project: asProjectId("web"),
};
const principal = asPrincipal("20:https://issuer.test/alice");

/** The URL one request names, whichever of the three shapes `fetch` was handed. */
const askedUrl = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof URL
    ? input
    : new URL(input instanceof Request ? input.url : input);

/** Answers every request with one response, recording what it was asked. */
function fetcherOf(answer: (asked: URL) => Response | Promise<Response>): {
  readonly fetch: typeof fetch;
  readonly asked: URL[];
} {
  const asked: URL[] = [];
  return {
    asked,
    fetch: (input) => {
      const at = askedUrl(input);
      asked.push(at);
      return Promise.resolve(answer(at));
    },
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

test("a permitted subject answers the authority derived from the principal", async () => {
  const fetcher = fetcherOf(() => json({ allowed: true }));
  assert.deepEqual(
    await ketoProjectAccess(settings, fetcher.fetch).authorize(
      principal,
      partition,
      "Mutate",
    ),
    memberAuthority(principal),
  );
  const asked = fetcher.asked[0];
  assert.ok(asked !== undefined);
  assert.equal(asked.pathname, "/relation-tuples/check/openapi");
  assert.equal(asked.searchParams.get("namespace"), "Project");
  assert.equal(
    asked.searchParams.get("object"),
    projectAccessObject(partition),
  );
  assert.equal(
    asked.searchParams.get("relation"),
    projectAccessPermits["Mutate"],
  );
  assert.equal(asked.searchParams.get("subject_id"), principal);
});

test("a refused subject answers nothing rather than raising", async () => {
  const fetcher = fetcherOf(() => json({ allowed: false }));
  assert.equal(
    await ketoProjectAccess(settings, fetcher.fetch).authorize(
      principal,
      partition,
      "Read",
    ),
    undefined,
  );
});

test("every kind asks for its own permit", async () => {
  for (const [kind, permit] of Object.entries(projectAccessPermits)) {
    const fetcher = fetcherOf(() => json({ allowed: true }));
    await ketoProjectAccess(settings, fetcher.fetch).authorize(
      principal,
      partition,
      kind as keyof typeof projectAccessPermits,
    );
    assert.equal(fetcher.asked[0]?.searchParams.get("relation"), permit);
  }
});

test("nothing the authority could not decide is answered as a refusal", async () => {
  const undecided: readonly (() => Response | Promise<Response>)[] = [
    () => json({ error: { code: 400 } }, 400),
    () => json({ error: { code: 404 } }, 404),
    () => json({ allowed: false }, 500),
    () => json({ allowed: false }, 503),
    () => new Response("not json at all", { status: 200 }),
    () => json({ allowed: "yes" }),
    () => json({ verdict: true }),
    () => json(null),
    () => new Response(null, { status: 200 }),
    () => Promise.reject(new TypeError("fetch failed")),
    () => new Response("x".repeat(ketoResponseBytesMax + 1), { status: 200 }),
  ];
  for (const [index, answer] of undecided.entries()) {
    const access = ketoProjectAccess(settings, fetcherOf(answer).fetch);
    await assert.rejects(
      () => access.authorize(principal, partition, "Read"),
      ProjectAccessUnavailable,
      `answer ${String(index)} was not treated as undecided`,
    );
  }
});

test("readiness needs the server up and every namespace the model declares", async () => {
  const model = new Set(["Project", "Tenant"]);
  const ready = (known: ReadonlySet<string>, health: number): typeof fetch =>
    fetcherOf((at) => {
      if (at.pathname === "/health/ready")
        return json({ status: "ok" }, health);
      const namespace = at.searchParams.get("namespace") ?? "";
      return known.has(namespace)
        ? json({ relation_tuples: [] })
        : json({ error: { code: 404 } }, 404);
    }).fetch;
  assert.equal(await ketoReadiness(settings, ready(model, 200)).ready(), true);
  assert.equal(await ketoReadiness(settings, ready(model, 503)).ready(), false);
  assert.equal(
    await ketoReadiness(settings, ready(new Set(["Project"]), 200)).ready(),
    false,
    "a model missing the tenant namespace reported itself ready",
  );
  assert.equal(
    await ketoReadiness(settings, ready(new Set(["Tenant"]), 200)).ready(),
    false,
    "a model missing the project namespace reported itself ready",
  );
});
