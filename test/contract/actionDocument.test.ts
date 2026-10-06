import assert from "node:assert/strict";
import test from "node:test";

import {
  actionDocumentSchema,
  actionDocumentVersion,
  actionIdentityCharsMax,
  actionNameCharsMax,
} from "../../src/contract/actionDocument.ts";
import { nativeHttpPathSegmentCharsMax } from "../../src/contract/http.ts";

const document = {
  version: actionDocumentVersion,
  action: "deploy-staging",
  name: "Deploy to staging",
};

const digits = "0123456789";
const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const lower = "abcdefghijklmnopqrstuvwxyz";

function admitted(value: unknown): boolean {
  return actionDocumentSchema.safeParse(value).success;
}

function without(field: keyof typeof document): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...document };
  delete rest[field];
  return rest;
}

/** Every ASCII character an identity admits where `placed` puts it, in code order. */
function identityAdmits(placed: (character: string) => string): string {
  let found = "";
  for (let code = 0; code < 0x80; code += 1) {
    const character = String.fromCharCode(code);
    if (admitted({ ...document, action: placed(character) }))
      found += character;
  }
  return found;
}

test("an action document names an identity and a display name", () => {
  assert.deepEqual(actionDocumentSchema.parse(document), document);
});

test("a field the document has no place for is refused rather than dropped", () => {
  for (const extra of [
    { repository: "https://forge.example/acme/engine.git" },
    { trigger: "push" },
    { command: "./deploy.sh" },
    { environment: "staging" },
  ])
    assert.equal(
      admitted({ ...document, ...extra }),
      false,
      JSON.stringify(extra),
    );
});

test("a document of another version, or of none, is refused", () => {
  assert.equal(admitted(without("version")), false);
  for (const version of [0, 2, "1", null])
    assert.equal(
      admitted({ ...document, version }),
      false,
      JSON.stringify(version),
    );
});

test("a document without an identity is refused", () => {
  assert.equal(admitted(without("action")), false);
});

test("a document without a display name is refused", () => {
  assert.equal(admitted(without("name")), false);
});

test("an identity begins and ends with a letter or a digit", () => {
  const ends = `${digits}${upper}${lower}`;
  assert.equal(
    identityAdmits((character) => character),
    ends,
  );
  assert.equal(
    identityAdmits((character) => `${character}a`),
    ends,
  );
  assert.equal(
    identityAdmits((character) => `a${character}`),
    ends,
  );
  assert.equal(admitted({ ...document, action: "" }), false);
});

test("between its ends an identity also holds a dot, an underscore and a hyphen, and nothing else", () => {
  assert.equal(
    identityAdmits((character) => `a${character}a`),
    `-.${digits}${upper}_${lower}`,
  );
  for (const action of ["déploy", "aａa", "a\u{1f600}a"])
    assert.equal(admitted({ ...document, action }), false, action);
});

test("an identity is one path segment exactly as it is written", () => {
  assert.ok(actionIdentityCharsMax <= nativeHttpPathSegmentCharsMax);
  for (const character of identityAdmits((inner) => `a${inner}a`))
    assert.equal(encodeURIComponent(character), character);
});

test("the longest identity is accepted and one character more is refused", () => {
  const identityOf = (chars: number) => "a".repeat(chars);
  assert.equal(
    admitted({ ...document, action: identityOf(actionIdentityCharsMax) }),
    true,
  );
  assert.equal(
    admitted({ ...document, action: identityOf(actionIdentityCharsMax + 1) }),
    false,
  );
});

test("a display name is text a stored row holds", () => {
  for (const name of ["", "Deploy\0", "\uD800", 7, null])
    assert.equal(admitted({ ...document, name }), false, JSON.stringify(name));
});

test("a display name is bounded by its characters and not by their encoding", () => {
  assert.equal(
    admitted({ ...document, name: "\u{1f600}".repeat(actionNameCharsMax) }),
    true,
  );
  assert.equal(
    admitted({ ...document, name: "x".repeat(actionNameCharsMax + 1) }),
    false,
  );
});
