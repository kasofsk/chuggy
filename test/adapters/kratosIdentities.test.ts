/**
 * The directory adapter against a double answering what the deployment's Ory
 * Kratos answered: what a creation sends, which statuses are a conflict, a
 * refused email or an outage, and that nothing Kratos wrote in free text or in
 * a field the plane does not use is kept.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  kratosAccessDirectory,
  kratosResponseBytesMax,
} from "../../src/adapters/kratos/identities.ts";
import {
  AccessDirectoryUnavailable,
  accessDirectorySubjectsMax,
  checkedAccessDirectorySettings,
} from "../../src/interpreter/accessDirectory.ts";
import { fixtureForge } from "./forgeFixtures.ts";

const settings = checkedAccessDirectorySettings({
  adminUrl: "http://kratos.invalid:4434/",
  requestTimeoutMs: 1_000,
});

const marker = "MARKER-not-for-a-response";

/**
 * Captured verbatim from the deployment's Kratos, and edited only into
 * TypeScript syntax: the identity a creation answered.
 */
const capturedIdentity = {
  id: "5804d32a-77dc-4fd5-9ef6-8f102ea642b1",
  credentials: {
    oidc: {
      type: "oidc",
      identifiers: ["github:990000001"],
      version: 0,
      created_at: "0001-01-01T00:00:00Z",
      updated_at: "0001-01-01T00:00:00Z",
    },
    password: {
      type: "password",
      identifiers: ["access-plane-probe@example.com"],
      version: 0,
      created_at: "0001-01-01T00:00:00Z",
      updated_at: "0001-01-01T00:00:00Z",
    },
  },
  schema_id: "default",
  schema_url: "https://id.vteng.io/schemas/ZGVmYXVsdA",
  state: "active",
  state_changed_at: "2026-10-08T03:07:10.326462719Z",
  traits: { email: "access-plane-probe@example.com" },
  metadata_public: null,
  metadata_admin: { invited_by: "probe" },
  created_at: "2026-10-08T03:07:10.330095Z",
  updated_at: "2026-10-08T03:07:10.330095Z",
  organization_id: null,
};

/** The conflict Kratos answered for an email or a credential another identity holds, alike. */
const capturedConflict = {
  error: {
    code: 409,
    status: "Conflict",
    reason:
      "This identity conflicts with another identity that already exists.",
    message: "The resource could not be created due to a conflict",
  },
};

/** An identity as an `ids` question answers it: without its credentials. */
function listed(id: string, metadata: unknown): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      Object.entries(capturedIdentity).filter(([key]) => key !== "credentials"),
    ),
    id,
    metadata_admin: metadata,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const github = { id: "990000001", login: "Octo-Cat" };

test("a creation sends the schema, the email trait, one github credential with the id as text, and the metadata, and answers the new subject", async () => {
  const forge = fixtureForge([json(capturedIdentity, 201)]);
  const directory = kratosAccessDirectory(settings, forge.requestFetch);
  assert.deepEqual(
    await directory.create({
      email: "access-plane-probe@example.com",
      github,
      invitedBy: "alice",
      tenant: "acme",
    }),
    { created: "Created", subject: capturedIdentity.id },
  );
  const [call] = forge.calls;
  assert.equal(call?.method, "POST");
  assert.equal(call?.url, "http://kratos.invalid:4434/admin/identities");
  assert.deepEqual(JSON.parse(call?.body ?? "null"), {
    schema_id: "default",
    traits: { email: "access-plane-probe@example.com" },
    credentials: {
      oidc: {
        config: { providers: [{ provider: "github", subject: "990000001" }] },
      },
    },
    metadata_admin: {
      invited_by: "alice",
      tenant: "acme",
      github_login: "Octo-Cat",
      github_id: "990000001",
    },
  });
});

test("a creation answered 409 is a conflict, 400 a refused email, and anything else an outage, none carrying Kratos's words", async () => {
  const create = (answer: Response | Error) =>
    kratosAccessDirectory(settings, fixtureForge([answer]).requestFetch).create(
      { email: "a@example.com", github, invitedBy: "alice", tenant: "acme" },
    );
  assert.deepEqual(await create(json(capturedConflict, 409)), {
    created: "Conflict",
  });
  assert.deepEqual(
    await create(
      json(
        { error: { code: 400, reason: `"${marker}" is not valid "email"` } },
        400,
      ),
    ),
    { created: "EmailRefused" },
  );
  for (const answer of [
    json({ error: { message: marker } }, 500),
    new Response(marker, { status: 201 }),
    json({ id: "chuggy-selector" }, 201),
    new TypeError("connection refused"),
  ])
    await assert.rejects(create(answer), (failure: unknown) => {
      assert.ok(failure instanceof AccessDirectoryUnavailable);
      assert.ok(!failure.message.includes(marker));
      return true;
    });
});

test("the GitHub credential's holder is found by its identifier, and the email is asked as its own", async () => {
  const forge = fixtureForge([
    json([capturedIdentity]),
    json([]),
    json([capturedIdentity]),
  ]);
  const directory = kratosAccessDirectory(settings, forge.requestFetch);
  assert.equal(await directory.githubHolder(github), capturedIdentity.id);
  assert.equal(
    await directory.githubHolder({ id: "990000002", login: "x" }),
    undefined,
  );
  assert.equal(
    await directory.emailHeld("Access-Plane-Probe@example.com"),
    true,
  );
  assert.deepEqual(
    forge.calls.map((call) =>
      new URL(call.url).searchParams.get("credentials_identifier"),
    ),
    ["github:990000001", "github:990000002", "Access-Plane-Probe@example.com"],
  );
});

test("an identity answered for a credential it does not carry is not its holder", async () => {
  const forge = fixtureForge([json([capturedIdentity])]);
  assert.equal(
    await kratosAccessDirectory(settings, forge.requestFetch).githubHolder({
      id: "990000002",
      login: "x",
    }),
    undefined,
  );
});

test("a page of subjects is one ids question, read for the email and the recorded login and nothing else", async () => {
  const one = "5804d32a-77dc-4fd5-9ef6-8f102ea642b1";
  const other = "00000000-0000-4000-8000-000000000001";
  const forge = fixtureForge([
    json([
      listed(one, { github_login: "Octo-Cat", invited_by: marker }),
      listed(other, null),
    ]),
  ]);
  const accounts = await kratosAccessDirectory(
    settings,
    forge.requestFetch,
  ).accounts([one, other, "00000000-0000-4000-8000-000000000002"]);
  assert.deepEqual(accounts, [
    {
      subject: one,
      email: "access-plane-probe@example.com",
      githubLogin: "Octo-Cat",
    },
    { subject: other, email: "access-plane-probe@example.com" },
  ]);
  assert.ok(!JSON.stringify(accounts).includes(marker));
  const asked = new URL(forge.calls[0]?.url ?? "");
  assert.deepEqual(asked.searchParams.getAll("ids"), [
    one,
    other,
    "00000000-0000-4000-8000-000000000002",
  ]);
  assert.equal(asked.searchParams.get("page_size"), "3");
});

test("an email or a login out of the shape the plane admits is dropped rather than answered", async () => {
  const one = "5804d32a-77dc-4fd5-9ef6-8f102ea642b1";
  const forge = fixtureForge([
    json([
      {
        ...listed(one, { github_login: `..${marker}` }),
        traits: { email: marker },
      },
    ]),
  ]);
  assert.deepEqual(
    await kratosAccessDirectory(settings, forge.requestFetch).accounts([one]),
    [{ subject: one }],
  );
});

test("a page of subjects past the bound or naming one of no UUID's shape is refused before anything is sent", async () => {
  const forge = fixtureForge([]);
  const directory = kratosAccessDirectory(settings, forge.requestFetch);
  await assert.rejects(directory.accounts(["chuggy-selector"]), RangeError);
  await assert.rejects(
    directory.accounts(
      Array.from(
        { length: accessDirectorySubjectsMax + 1 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
    ),
    RangeError,
  );
  assert.deepEqual(await directory.accounts([]), []);
  assert.deepEqual(forge.calls, []);
});

test("an answer past the byte bound is an outage", async () => {
  const forge = fixtureForge([
    new Response("[" + " ".repeat(kratosResponseBytesMax) + "]", {
      status: 200,
    }),
  ]);
  await assert.rejects(
    kratosAccessDirectory(settings, forge.requestFetch).emailHeld(
      "a@example.com",
    ),
    AccessDirectoryUnavailable,
  );
});
