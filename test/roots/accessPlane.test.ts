/**
 * The access plane's root: what it says about an environment it cannot start
 * under, and that its composition, handed a double for the authentication,
 * serves the plane.
 *
 * IT IS DRIVEN AS A PROCESS BECAUSE NOTHING MAY IMPORT ONE. The composition is
 * imported inside a child program, where `.dependency-cruiser.cjs` does not
 * look, and no case reaches an issuer or an authority.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Every variable the root refuses to start without, each naming nothing that answers. */
const required: Readonly<Record<string, string>> = {
  CHUG_ACCESS_PLANE_OIDC_ISSUER: "https://issuer.invalid",
  CHUG_ACCESS_PLANE_OIDC_AUDIENCE: "chuggy",
  CHUG_ACCESS_PLANE_OIDC_ALGORITHMS: "RS256",
  CHUG_ACCESS_PLANE_KETO_READ_URL: "http://127.0.0.1:1/",
  CHUG_ACCESS_PLANE_KETO_WRITE_URL: "http://127.0.0.1:2/",
};

/** The caller's environment with no access plane variable in it but `named`. */
function environmentOf(
  named: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.startsWith("CHUG_ACCESS_PLANE_"),
      ),
    ),
    ...named,
  };
}

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function ran(
  argv: readonly string[],
  named: Readonly<Record<string, string>>,
): Promise<Ran> {
  try {
    const done = await execute(
      process.execPath,
      ["--experimental-strip-types", ...argv],
      { cwd: process.cwd(), env: environmentOf(named) },
    );
    return { code: 0, stdout: done.stdout, stderr: done.stderr };
  } catch (failure) {
    const done = failure as { code?: number; stdout?: string; stderr?: string };
    return {
      code: done.code ?? 1,
      stdout: done.stdout ?? "",
      stderr: done.stderr ?? "",
    };
  }
}

test("a start missing any required variable is refused naming it, before the issuer is asked", async () => {
  for (const missing of Object.keys(required)) {
    const named = Object.fromEntries(
      Object.entries(required).filter(([name]) => name !== missing),
    );
    const answered = await ran(["src/roots/accessPlane.ts"], named);
    assert.equal(answered.code, 1, missing);
    assert.equal(answered.stderr, `access plane: ${missing} is required\n`);
  }
});

const composed = `
  const { accessPlaneEnvironment, accessPlaneComposed } = await import('./src/roots/accessPlane.ts');
  const app = accessPlaneComposed(accessPlaneEnvironment(), {
    authenticateBearer: () => Promise.resolve({ authenticated: 'InvalidToken' }),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const at = 'http://127.0.0.1:' + String(app.server.address().port);
  const live = await fetch(at + '/health/live');
  const people = await fetch(at + '/access/v1/tenants/acme/people', {
    headers: { authorization: 'Bearer forged' },
  });
  process.stdout.write(JSON.stringify([live.status, await live.json(), people.status]));
  await app.close();
`;

test("composed with a double for the authentication, the root serves its probe and its routes", async () => {
  const answered = await ran(
    ["--input-type=module", "--eval", composed],
    required,
  );
  assert.equal(answered.code, 0, answered.stderr);
  assert.deepEqual(JSON.parse(answered.stdout), [200, { status: "live" }, 401]);
});

const invited = `
  const { accessPlaneEnvironment, accessPlaneComposed } = await import('./src/roots/accessPlane.ts');
  const { oidcPrincipal } = await import('./src/interpreter/principal.ts');
  const app = accessPlaneComposed(accessPlaneEnvironment(), {
    authenticateBearer: () => Promise.resolve({
      authenticated: 'Bearer',
      bearer: { principal: oidcPrincipal('https://issuer.invalid', 'alice') },
    }),
  });
  const answered = await app.inject({
    method: 'POST',
    url: '/access/v1/tenants/acme/invitations',
    headers: { authorization: 'Bearer alice', 'content-type': 'application/vnd.chuggy.v1+json' },
    payload: JSON.stringify({ github: 'octo-cat', email: 'octo@example.com', role: 'Member' }),
  });
  process.stdout.write(JSON.stringify([answered.statusCode, answered.json()]));
  await app.close();
`;

test("with no directory address the root starts and answers an invitation as not configured", async () => {
  const answered = await ran(
    ["--input-type=module", "--eval", invited],
    required,
  );
  assert.equal(answered.code, 0, answered.stderr);
  assert.deepEqual(JSON.parse(answered.stdout), [
    404,
    {
      error: {
        code: "InvitationNotConfigured",
        message: "This deployment invites nobody.",
      },
    },
  ]);
});

test("a directory address that is not HTTP is refused naming it", async () => {
  const answered = await ran(["src/roots/accessPlane.ts"], {
    ...required,
    CHUG_ACCESS_PLANE_KRATOS_ADMIN_URL: "ftp://kratos.invalid/",
  });
  assert.equal(answered.code, 1);
  assert.equal(
    answered.stderr,
    "access plane: directory admin URL must be HTTP or HTTPS\n",
  );
});
