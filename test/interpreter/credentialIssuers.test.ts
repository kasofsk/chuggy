/**
 * The resolver over credential issuers: which names it asks them for, what it
 * answers for each name, and an outage of any issuer as an outage of all.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerHeldCredentialBundle } from "../../src/contract/workerPlane.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import {
  credentialResolver,
  type CredentialIssued,
  type CredentialIssuer,
  type CredentialRequester,
} from "../../src/interpreter/credentialIssuers.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const requester: CredentialRequester = {
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  ticket: asTicketId(7),
  task: asTaskId(11),
};

function bundle(credential: string): WorkerHeldCredentialBundle {
  return {
    credential,
    files: [{ file: "secret", content: { kind: "Secret", secret: "s" } }],
    variables: [{ kind: "Path", variable: "TOKEN_FILE", file: "secret" }],
  };
}

/** An issuer answering each name from `answers`, every other name not its own, recording what it was asked. */
function issuer(
  answers: Readonly<Record<string, CredentialIssued>>,
  asked: string[] = [],
): CredentialIssuer {
  return {
    issue: (who, credential) => {
      assert.equal(who, requester);
      asked.push(credential);
      return Promise.resolve(answers[credential] ?? { issued: "NotServed" });
    },
  };
}

const everything = {
  requester,
  listed: ["a", "b", "c", "d"],
  granted: ["a", "b", "c", "d"],
};

test("a name the configuration did not list is left out, and no issuer is asked for it", async () => {
  const asked: string[] = [];
  const resolver = credentialResolver([
    issuer({ x: { issued: "Bundle", bundle: bundle("x") } }, asked),
  ]);
  assert.deepEqual(
    await resolver.resolve({ ...everything, granted: ["x"], asked: ["x"] }),
    { resolved: "Credentials", credentials: [], absent: [] },
  );
  assert.deepEqual(asked, []);
});

test("a listed name the grant does not carry is absent as not granted, and no issuer is asked for it", async () => {
  const asked: string[] = [];
  const resolver = credentialResolver([
    issuer({ a: { issued: "Bundle", bundle: bundle("a") } }, asked),
  ]);
  assert.deepEqual(
    await resolver.resolve({ ...everything, granted: [], asked: ["a"] }),
    {
      resolved: "Credentials",
      credentials: [],
      absent: [{ credential: "a", reason: "NotGranted" }],
    },
  );
  assert.deepEqual(asked, []);
});

test("each name is answered once, in the order asked, by the first issuer serving it", async () => {
  const first: string[] = [];
  const second: string[] = [];
  const resolver = credentialResolver([
    issuer({ b: { issued: "Absent", reason: "NotEnabled" } }, first),
    issuer(
      {
        a: { issued: "Bundle", bundle: bundle("a") },
        b: { issued: "Bundle", bundle: bundle("b") },
      },
      second,
    ),
  ]);
  assert.deepEqual(
    await resolver.resolve({ ...everything, asked: ["c", "b", "a", "c", "a"] }),
    {
      resolved: "Credentials",
      credentials: [bundle("a")],
      absent: [
        { credential: "c", reason: "NotHeld" },
        { credential: "b", reason: "NotEnabled" },
      ],
    },
  );
  assert.deepEqual(first, ["c", "b", "a"]);
  assert.deepEqual(
    second,
    ["c", "a"],
    "an issuer was asked past the first answer",
  );
});

test("an outage of any issuer is an outage of the whole answer, never an absence", async () => {
  const outages: readonly CredentialIssuer[] = [
    issuer({ b: { issued: "Unavailable" } }),
    { issue: () => Promise.reject(new Error("unreachable")) },
  ];
  for (const outage of outages) {
    const resolver = credentialResolver([
      issuer({ a: { issued: "Bundle", bundle: bundle("a") } }),
      outage,
    ]);
    assert.deepEqual(
      await resolver.resolve({ ...everything, asked: ["a", "b", "c"] }),
      { resolved: "Unavailable" },
    );
  }
});

test("a resolver over no issuers names every listed and granted name not held", async () => {
  assert.deepEqual(
    await credentialResolver([]).resolve({ ...everything, asked: ["d"] }),
    {
      resolved: "Credentials",
      credentials: [],
      absent: [{ credential: "d", reason: "NotHeld" }],
    },
  );
});
