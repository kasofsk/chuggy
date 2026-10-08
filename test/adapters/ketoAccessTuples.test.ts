/**
 * The listing as the access plane asks it of the authority: what each query is
 * sent as, how a tuple's subject is read, and that the widest page this tree
 * can write is read rather than refused as past its bound.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ketoAccessPageTuplesMax,
  ketoAccessTuples,
  ketoTupleBytesMax,
} from "../../src/adapters/keto/accessTuples.ts";
import { ketoResponseBytesMax } from "../../src/adapters/keto/request.ts";
import { nativeHttpPathSegmentCharsMax } from "../../src/contract/http.ts";
import {
  checkedProjectAccessSettings,
  ProjectAccessUnavailable,
  projectAccessObject,
} from "../../src/interpreter/projectAccess.ts";
import { principalCharsMax } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const settings = checkedProjectAccessSettings({
  readUrl: "http://keto.test:4466",
  requestTimeoutMs: 250,
});

/** A reader answering every page with `body`, and the URLs it was asked. */
function readerOf(body: string) {
  const asked: URL[] = [];
  const reader = ketoAccessTuples(settings, (input) => {
    assert.ok(input instanceof URL);
    asked.push(input);
    return Promise.resolve(new Response(body, { status: 200 }));
  });
  return { asked, reader };
}

test("a tenant's projects are asked by the link naming it, and the next page by its token", async () => {
  const { asked, reader } = readerOf(
    JSON.stringify({
      relation_tuples: [
        {
          namespace: "Project",
          object: "4:acmeweb",
          relation: "tenant",
          subject_set: { namespace: "Tenant", object: "4:acme", relation: "" },
        },
        {
          namespace: "Project",
          object: "4:acmeweb",
          relation: "admins",
          subject_id: "p",
        },
      ],
      next_page_token: "next",
    }),
  );
  const page = await reader.page(
    { query: "TenantProjects", tenant: asTenantId("acme") },
    "this",
  );
  assert.deepEqual(page, {
    tuples: [
      {
        object: "4:acmeweb",
        relation: "tenant",
        subject: { subject: "Set", namespace: "Tenant", object: "4:acme" },
      },
      {
        object: "4:acmeweb",
        relation: "admins",
        subject: { subject: "Id", id: "p" },
      },
    ],
    next: "next",
  });
  const query = Object.fromEntries(asked[0]?.searchParams ?? []);
  assert.deepEqual(query, {
    namespace: "Project",
    relation: "tenant",
    "subject_set.namespace": "Tenant",
    "subject_set.object": "4:acme",
    "subject_set.relation": "",
    page_size: String(ketoAccessPageTuplesMax),
    page_token: "this",
  });
});

test("an answer that is not a page is undecided", async () => {
  await assert.rejects(
    readerOf(JSON.stringify({ allowed: true })).reader.page(
      { query: "Object", namespace: "Tenant", object: "4:acme" },
      undefined,
    ),
    ProjectAccessUnavailable,
  );
});

test("the widest page this tree can write, every character escaped, is read and not refused", async () => {
  assert.ok(ketoAccessPageTuplesMax > 1);
  const escaped = (chars: number) => "\u0001".repeat(chars);
  const object = projectAccessObject({
    tenant: asTenantId(escaped(nativeHttpPathSegmentCharsMax)),
    project: asProjectId(escaped(nativeHttpPathSegmentCharsMax)),
  });
  assert.ok(object.length >= principalCharsMax);
  const tuple = {
    namespace: "Project",
    object,
    relation: "dispatcher_granters",
    subject_set: { namespace: "Project", object, relation: "dispatchers" },
  };
  const body = JSON.stringify({
    relation_tuples: Array.from(
      { length: ketoAccessPageTuplesMax },
      () => tuple,
    ),
    next_page_token: escaped(Math.floor(ketoTupleBytesMax / 6) - 1),
  });
  assert.ok(Buffer.byteLength(body) <= ketoResponseBytesMax);
  const page = await readerOf(body).reader.page(
    { query: "Object", namespace: "Project", object },
    undefined,
  );
  assert.equal(page.tuples.length, ketoAccessPageTuplesMax);
});
