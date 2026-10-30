/**
 * The credentials a deployment holds as files: the roster it names them in,
 * refused whole where any entry is wrong, and which of them one attempt is
 * served.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { heldCredentialSecretCharsMax } from "../../src/contract/workerPlane.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  heldCredentialRoster,
  heldCredentialSecret,
  heldCredentialsMax,
  heldCredentialsSelected,
  workerPlaneHeldCredentials,
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

test("a credential is selected only where it is asked for, granted, and held for the attempt's project", () => {
  const ask = { partition, granted: ["track-record"], asked: ["track-record"] };
  assert.deepEqual(heldCredentialsSelected(held, ask), held);
  for (const [what, refused] of [
    ["unasked", { ...ask, asked: [] }],
    ["asked for something else", { ...ask, asked: ["other"] }],
    ["ungranted", { ...ask, granted: [] }],
    ["granted something else", { ...ask, granted: ["other"] }],
    [
      "another project",
      { ...ask, partition: { ...partition, project: asProjectId("other") } },
    ],
    [
      "another tenant",
      { ...ask, partition: { ...partition, tenant: asTenantId("other") } },
    ],
  ] as const)
    assert.deepEqual(heldCredentialsSelected(held, refused), [], what);
});

test("a credential asked for twice is selected once", () => {
  assert.deepEqual(
    heldCredentialsSelected(held, {
      partition,
      granted: ["track-record"],
      asked: ["track-record", "track-record"],
    }),
    held,
  );
});

test("a selected file is read as asked, trimmed, and an unreadable or blank one is an outage", async () => {
  const files = new Map<string, string | undefined>();
  const read: string[] = [];
  const served = workerPlaneHeldCredentials(held, (file) => {
    read.push(file);
    return Promise.resolve(files.get(file));
  });
  const ask = { partition, granted: ["track-record"], asked: ["track-record"] };
  const file = "/var/run/secrets/track-record";

  files.set(file, "  first\n");
  assert.deepEqual(await served.served(ask), {
    answered: "Credentials",
    credentials: [
      {
        credential: "track-record",
        variable: "TRACK_RECORD_TOKEN_FILE",
        secret: "first",
      },
    ],
  });
  files.set(file, "second");
  const second = await served.served(ask);
  assert.ok(second.answered === "Credentials");
  assert.equal(second.credentials[0]?.secret, "second");
  for (const text of [undefined, "", " \n\t"]) {
    files.set(file, text);
    assert.deepEqual(await served.served(ask), { answered: "Unavailable" });
  }
  assert.deepEqual(
    await workerPlaneHeldCredentials(held, () =>
      Promise.reject(new Error("unreadable")),
    ).served(ask),
    { answered: "Unavailable" },
  );
  assert.deepEqual(await served.served({ ...ask, granted: [] }), {
    answered: "Credentials",
    credentials: [],
  });
  assert.equal(read.length, 5, "an unserved credential's file was read");
});

test("a secret longer than the contract carries is none", () => {
  const atBound = "s".repeat(heldCredentialSecretCharsMax);
  assert.equal(heldCredentialSecret(` ${atBound}\n`), atBound);
  assert.equal(heldCredentialSecret(`${atBound}s`), undefined);
});
