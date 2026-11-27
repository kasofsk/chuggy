/**
 * The agreement plane's root: what it says about an environment it cannot
 * start under, and that its composition, handed a double for the
 * authentication, serves the plane on the listeners the environment names.
 *
 * IT IS DRIVEN AS A PROCESS BECAUSE NOTHING MAY IMPORT ONE. The composition is
 * imported inside a child program, where `.dependency-cruiser.cjs` does not
 * look, and no case reaches an issuer or a database.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { planeRootRan } from "./harness.ts";

/** Every variable the root refuses to start without, each naming nothing that answers. */
const required: Readonly<Record<string, string>> = {
  CHUG_AGREEMENT_PLANE_DATABASE_URL: "postgres://nobody@127.0.0.1:1/none",
  CHUG_AGREEMENT_PLANE_OIDC_ISSUER: "https://issuer.invalid",
  CHUG_AGREEMENT_PLANE_OIDC_AUDIENCE: "chuggy",
  CHUG_AGREEMENT_PLANE_OIDC_ALGORITHMS: "RS256",
};

/** `argv` run to its end with no agreement plane variable but `named`. */
function ran(argv: readonly string[], named: Readonly<Record<string, string>>) {
  return planeRootRan("CHUG_AGREEMENT_PLANE_", argv, named);
}

test("a start missing any required variable is refused naming it, before the issuer is asked", async () => {
  for (const missing of Object.keys(required)) {
    const named = Object.fromEntries(
      Object.entries(required).filter(([name]) => name !== missing),
    );
    const answered = await ran(["src/roots/agreementPlane.ts"], named);
    assert.equal(answered.code, 1, missing);
    assert.equal(answered.stderr, `agreement plane: ${missing} is required\n`);
  }
});

test("a malformed optional value refuses the start naming its variable, before the issuer is asked", async () => {
  for (const [variable, value] of [
    ["CHUG_AGREEMENT_PLANE_POLICIES", "[{"],
    ["CHUG_AGREEMENT_PLANE_POLICIES", '[{"policy":"terms"}]'],
    ["CHUG_AGREEMENT_PLANE_SERVICE_PORT", "nine"],
    ["CHUG_AGREEMENT_PLANE_SERVICE_PORT", "70000"],
    ["CHUG_AGREEMENT_PLANE_CLIENT_ADDRESS_HEADER", "x forwarded"],
  ] as const) {
    const answered = await ran(["src/roots/agreementPlane.ts"], {
      ...required,
      [variable]: value,
    });
    assert.equal(answered.code, 1, value);
    assert.match(
      answered.stderr,
      new RegExp(`^agreement plane: ${variable} `, "u"),
      value,
    );
  }
});

/** The plane composed over a double that knows one bearer, asked its policies and that bearer's standing on each listener. */
const composed = `
  const { agreementPlaneEnvironment, agreementPlaneComposed } = await import('./src/roots/agreementPlane.ts');
  const { oidcPrincipal } = await import('./src/interpreter/principal.ts');
  const environment = agreementPlaneEnvironment();
  const { callers, service } = agreementPlaneComposed(environment, {
    authenticateBearer: (token) => Promise.resolve(token === 'alice'
      ? { authenticated: 'Bearer', bearer: { principal: oidcPrincipal(environment.oidc.issuer, 'alice') } }
      : { authenticated: 'InvalidToken' }),
  });
  const live = await callers.inject({ url: '/health/live' });
  const policies = await callers.inject({ url: '/agreements/v1/policies' });
  const standing = await callers.inject({
    url: '/agreements/v1/standing',
    headers: { authorization: 'Bearer alice' },
  });
  const person = service === undefined
    ? undefined
    : (await service.inject({ url: '/agreements/v1/people/someone/standing' })).json();
  process.stdout.write(JSON.stringify({
    live: live.statusCode,
    policies: policies.json(),
    standing: standing.json(),
    service: service !== undefined,
    person,
  }));
  await callers.close();
  await service?.close();
`;

test("with no policies configured the plane answers none and an empty standing, and opens no service listener", async () => {
  for (const policies of [undefined, "[]"]) {
    const answered = await ran(
      ["--input-type=module", "--eval", composed],
      policies === undefined
        ? required
        : { ...required, CHUG_AGREEMENT_PLANE_POLICIES: policies },
    );
    assert.equal(answered.code, 0, answered.stderr);
    assert.deepEqual(JSON.parse(answered.stdout), {
      live: 200,
      policies: { policies: [] },
      standing: { policies: [] },
      service: false,
    });
  }
});

test("a service port named composes the service listener, which answers a person's standing", async () => {
  const answered = await ran(["--input-type=module", "--eval", composed], {
    ...required,
    CHUG_AGREEMENT_PLANE_SERVICE_PORT: "3007",
  });
  assert.equal(answered.code, 0, answered.stderr);
  const read = JSON.parse(answered.stdout) as {
    service: boolean;
    person: unknown;
  };
  assert.equal(read.service, true);
  assert.deepEqual(read.person, { policies: [] });
});
