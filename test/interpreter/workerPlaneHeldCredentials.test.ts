/**
 * The credentials a deployment holds as files: the roster it names them in,
 * refused whole where any entry is wrong, and the issuer that serves them.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  heldCredentialSecretCharsMax,
  workerHeldCredentialBundleSchema,
} from "../../src/contract/workerPlane.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { credentialResolver } from "../../src/interpreter/credentialIssuers.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  heldCredentialIssuer,
  heldCredentialRoster,
  heldCredentialSecret,
  heldCredentialsMax,
  type HeldCredential,
} from "../../src/interpreter/workerPlaneHeldCredentials.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

/** One roster entry as a deployment writes it, `over` replacing the fields a case is about. */
function entry(over: Readonly<Record<string, unknown>> = {}) {
  return {
    credential: "track-record",
    tenant: "tenant",
    project: "project",
    variable: "TRACK_RECORD_TOKEN_FILE",
    file: "/var/run/secrets/track-record",
    ...over,
  };
}

const held: readonly HeldCredential[] = [
  {
    credential: "track-record",
    partition,
    variable: "TRACK_RECORD_TOKEN_FILE",
    file: "/var/run/secrets/track-record",
  },
];

test("an empty roster holds nothing", () => {
  assert.deepEqual(heldCredentialRoster("[]"), { read: "Roster", held: [] });
});

test("a roster is read as the credentials it holds, several entries naming one file", () => {
  const read = heldCredentialRoster(
    JSON.stringify([entry(), entry({ project: "other" })]),
  );
  assert.deepEqual(read, {
    read: "Roster",
    held: [
      held[0],
      { ...held[0], partition: { ...partition, project: "other" } },
    ],
  });
});

test("a roster is refused for each thing wrong with it, naming no file", () => {
  for (const [encoded, why] of [
    ["not json", /is not JSON/u],
    [JSON.stringify({}), /is not a roster/u],
    [JSON.stringify([entry({ unknown: true })]), /is not a roster/u],
    [JSON.stringify([entry({ credential: "" })]), /is not a roster/u],
    [JSON.stringify([entry({ file: "" })]), /is not a roster/u],
    [
      JSON.stringify(Array.from({ length: heldCredentialsMax + 1 }, entry)),
      /is not a roster/u,
    ],
    [
      JSON.stringify([entry(), entry()]),
      /holds track-record for tenant\/project twice/u,
    ],
    [JSON.stringify([entry(), entry({ file: "/elsewhere" })]), /twice/u],
    [
      JSON.stringify([entry({ credential: "chuggy.github" })]),
      /names chuggy\.github, which is in the prefix chuggy\. reserved/u,
    ],
    ...[
      "TRACK_RECORD_TOKEN",
      "track_record_FILE",
      "CHUG_TOKEN_FILE",
      "CLAUDE_TOKEN_FILE",
      "GIT_TOKEN_FILE",
    ].map(
      (variable) =>
        [
          JSON.stringify([entry({ variable })]),
          new RegExp(variable, "u"),
        ] as const,
    ),
  ] as const) {
    const read = heldCredentialRoster(encoded);
    assert.equal(read.read, "Refused", encoded);
    if (read.read === "Refused") {
      assert.match(read.why, why, encoded);
      assert.doesNotMatch(read.why, /\/var\/run\/secrets/u, encoded);
    }
  }
});

test("a secret longer than the contract carries is none", () => {
  const atBound = "s".repeat(heldCredentialSecretCharsMax);
  assert.equal(heldCredentialSecret(` ${atBound}\n`), atBound);
  assert.equal(heldCredentialSecret(`${atBound}s`), undefined);
  const astral = "\u{1F511}".repeat(heldCredentialSecretCharsMax);
  assert.equal(
    heldCredentialSecret(astral),
    astral,
    "a bound counted in UTF-16 units",
  );
});

test("a roster may hold a name that only contains the reserved prefix past its start", () => {
  assert.equal(
    heldCredentialRoster(JSON.stringify([entry({ credential: "my.chuggy.x" })]))
      .read,
    "Roster",
  );
});

const requester = { partition, ticket: asTicketId(1), task: asTaskId(2) };

test("the file issuer serves a credential held for the requester's project as a bundle of its one file, read as it is asked", async () => {
  const files = new Map<string, string | undefined>([
    ["/var/run/secrets/track-record", "  first\n"],
  ]);
  const issuer = heldCredentialIssuer(held, (file) =>
    Promise.resolve(files.get(file)),
  );
  const issued = await issuer.issue(requester, "track-record");
  assert.deepEqual(issued, {
    issued: "Bundle",
    bundle: {
      credential: "track-record",
      files: [{ file: "secret", content: { kind: "Secret", secret: "first" } }],
      variables: [
        { kind: "Path", variable: "TRACK_RECORD_TOKEN_FILE", file: "secret" },
      ],
    },
  });
  if (issued.issued === "Bundle")
    assert.ok(
      workerHeldCredentialBundleSchema.safeParse(issued.bundle).success,
    );
  files.set("/var/run/secrets/track-record", " \n");
  assert.deepEqual(await issuer.issue(requester, "track-record"), {
    issued: "Unavailable",
  });
});

test("the file issuer does not serve a name it holds for no project or for another one, and reads no file for it", async () => {
  const read: string[] = [];
  const issuer = heldCredentialIssuer(held, (file) => {
    read.push(file);
    return Promise.resolve("secret");
  });
  for (const [who, credential] of [
    [requester, "other"],
    [
      {
        ...requester,
        partition: { ...partition, project: asProjectId("other") },
      },
      "track-record",
    ],
    [
      {
        ...requester,
        partition: { ...partition, tenant: asTenantId("other") },
      },
      "track-record",
    ],
  ] as const)
    assert.deepEqual(await issuer.issue(who, credential), {
      issued: "NotServed",
    });
  assert.deepEqual(read, []);
});

test("a resolver over the file issuer names a listed name absent, and an unreadable file an outage", async () => {
  const resolver = credentialResolver([
    heldCredentialIssuer(held, () => Promise.reject(new Error("unreadable"))),
  ]);
  const ask = {
    requester,
    listed: ["track-record", "other"],
    granted: ["other"],
  };
  assert.deepEqual(
    await resolver.resolve({ ...ask, asked: ["track-record", "other"] }),
    {
      resolved: "Credentials",
      credentials: [],
      absent: [
        { credential: "track-record", reason: "NotGranted" },
        { credential: "other", reason: "NotHeld" },
      ],
    },
  );
  assert.deepEqual(
    await resolver.resolve({
      ...ask,
      granted: ["track-record"],
      asked: ["track-record"],
    }),
    { resolved: "Unavailable" },
  );
});
