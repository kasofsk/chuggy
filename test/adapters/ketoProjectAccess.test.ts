import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ketoProjectAccess,
  ketoReadiness,
  ketoTenantClaims,
} from "../../src/adapters/keto/projectAccess.ts";
import { ketoResponseBytesMax } from "../../src/adapters/keto/request.ts";
import {
  checkedProjectAccessSettings,
  memberAuthority,
  ProjectAccessUnavailable,
  projectAccessObject,
  projectAccessPermits,
  projectAccessTenantObject,
  siteAccessPermits,
  tenantAccessPermits,
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

test("a site kind asks the site's one object for its own permit", async () => {
  for (const [kind, permit] of Object.entries(siteAccessPermits)) {
    const fetcher = fetcherOf(() => json({ allowed: true }));
    assert.deepEqual(
      await ketoProjectAccess(settings, fetcher.fetch).authorizeSite(
        principal,
        kind as keyof typeof siteAccessPermits,
      ),
      memberAuthority(principal),
    );
    const asked = fetcher.asked[0];
    assert.ok(asked !== undefined);
    assert.deepEqual(
      [...asked.searchParams],
      [
        ["namespace", "Site"],
        ["object", "main"],
        ["relation", permit],
        ["subject_id", principal],
      ],
    );
  }
  const refused = fetcherOf(() => json({ allowed: false }));
  assert.equal(
    await ketoProjectAccess(settings, refused.fetch).authorizeSite(
      principal,
      "CreateAccount",
    ),
    undefined,
  );
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

test("a tenant is claimed by a tuple on its own object, else by a project naming it as its tenant", async () => {
  const object = projectAccessTenantObject(partition.tenant);
  const listings = [
    [
      ["namespace", "Tenant"],
      ["object", object],
      ["page_size", "1"],
    ],
    [
      ["namespace", "Project"],
      ["relation", "tenant"],
      ["subject_set.namespace", "Tenant"],
      ["subject_set.object", object],
      ["subject_set.relation", ""],
      ["page_size", "1"],
    ],
  ];
  for (const held of listings.keys()) {
    let asked = 0;
    const answering = fetcherOf(() =>
      json({ relation_tuples: asked++ === held ? [{}] : [] }),
    );
    assert.equal(
      await ketoTenantClaims(settings, answering.fetch).claimed(
        partition.tenant,
      ),
      true,
      String(held),
    );
    assert.deepEqual(
      answering.asked.map((at) => [at.pathname, [...at.searchParams]]),
      listings.slice(0, held + 1).map((params) => ["/relation-tuples", params]),
      String(held),
    );
  }
  const neither = fetcherOf(() => json({ relation_tuples: [] }));
  assert.equal(
    await ketoTenantClaims(settings, neither.fetch).claimed(partition.tenant),
    false,
  );
  assert.equal(neither.asked.length, listings.length);
});

test("no listing the authority could not answer is taken for an unclaimed tenant, whichever listing it is", async () => {
  const faults: readonly (() => Response)[] = [
    () => json({ relation_tuples: [] }, 503),
    () => json({ error: { code: 404 } }, 404),
    () => json({ relation_tuples: {} }),
    () => json({ tuples: [] }),
    () => json(null),
  ];
  for (const faulted of [0, 1])
    for (const [index, fault] of faults.entries()) {
      let asked = 0;
      const answering = fetcherOf(() =>
        asked++ === faulted ? fault() : json({ relation_tuples: [] }),
      );
      await assert.rejects(
        () =>
          ketoTenantClaims(settings, answering.fetch).claimed(partition.tenant),
        ProjectAccessUnavailable,
        `listing ${String(faulted)} answer ${String(index)} was not treated as undecided`,
      );
      assert.equal(answering.asked.length, faulted + 1);
    }
});

const checkPath = "relation-tuples/check/openapi";
const wholeModel = new Set(["Project", "Tenant", "Site"]);
const everyPermit = new Set([
  ...Object.values(projectAccessPermits).map((permit) => `Project#${permit}`),
  ...Object.values(tenantAccessPermits).map((permit) => `Tenant#${permit}`),
  ...Object.values(siteAccessPermits).map((permit) => `Site#${permit}`),
]);

/**
 * An authority carrying a model: the namespaces it knows and the permits it
 * declares, each as its namespace and its name, answering each path the
 * readiness probe asks the way Keto does.
 */
const ready = (
  known: ReadonlySet<string>,
  declared: ReadonlySet<string>,
  health = 200,
): typeof fetch =>
  fetcherOf((at) => {
    if (at.pathname === "/health/ready") return json({ status: "ok" }, health);
    if (at.pathname === `/${checkPath}`)
      return declared.has(
        `${at.searchParams.get("namespace") ?? ""}#${at.searchParams.get("relation") ?? ""}`,
      )
        ? json({ allowed: false })
        : json({ error: { code: 400 } }, 400);
    const namespace = at.searchParams.get("namespace") ?? "";
    return known.has(namespace)
      ? json({ relation_tuples: [] })
      : json({ error: { code: 404 } }, 404);
  }).fetch;

/**
 * The bound is a property of the request rather than of the server, so the
 * case supplies a server that never answers at all: what it proves is that the
 * settings reach the fetch, which nothing else here asks.
 */
test(
  "a request the authority never answers is abandoned at the bound the settings carry",
  { timeout: 5_000 },
  async () => {
    const bounded = checkedProjectAccessSettings({
      readUrl: "http://keto.test:4466",
      requestTimeoutMs: 50,
    });
    let bound: AbortSignal | undefined;
    const hanging: typeof fetch = (_at, init) =>
      new Promise((_answer, abandon) => {
        bound = init?.signal ?? undefined;
        bound?.addEventListener("abort", () => {
          abandon(new Error("the request was abandoned"));
        });
      });
    await assert.rejects(
      () =>
        ketoProjectAccess(bounded, hanging).authorize(
          principal,
          partition,
          "Read",
        ),
      ProjectAccessUnavailable,
    );
    assert.ok(
      bound instanceof AbortSignal,
      "the request carried no signal to abandon it by",
    );
  },
);

test("readiness needs the server up and every namespace the model declares", async () => {
  assert.equal(
    await ketoReadiness(settings, ready(wholeModel, everyPermit)).ready(),
    true,
  );
  assert.equal(
    await ketoReadiness(settings, ready(wholeModel, everyPermit, 503)).ready(),
    false,
  );
  for (const missing of wholeModel) {
    const without = new Set([...wholeModel].filter((it) => it !== missing));
    assert.equal(
      await ketoReadiness(settings, ready(without, everyPermit)).ready(),
      false,
      `a model missing the ${missing} namespace reported itself ready`,
    );
  }
});

test("readiness needs every permit a check will ask for", async () => {
  assert.ok(everyPermit.has("Site#create_tenant"));
  for (const missing of everyPermit) {
    const without = new Set([...everyPermit].filter((it) => it !== missing));
    assert.equal(
      await ketoReadiness(settings, ready(wholeModel, without)).ready(),
      false,
      `a model without the ${missing} permit reported itself ready`,
    );
  }
});
