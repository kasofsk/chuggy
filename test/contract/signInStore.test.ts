/**
 * The shared sign-in store as each program that keeps a sign-in in it reads
 * it: where it is on every platform it is defined for, what a site's file
 * holds, what the records beside it hold and for whom, which names are drafts
 * a lock holder removes, and when a lock is nobody's.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  signInStoreAccessDigest,
  signInStoreAccessName,
  signInStoreAccessRead,
  signInStoreAccessText,
  signInStoreDirectory,
  signInStoreDraftName,
  signInStoreDraftOf,
  signInStoreEndedDescriptionCharsMax,
  signInStoreEndedErrorCharsMax,
  signInStoreEndedName,
  signInStoreEndedRead,
  signInStoreEndedText,
  signInStoreFileName,
  signInStoreLockHolder,
  signInStoreLockName,
  signInStoreLockSecsMax,
  signInStoreLockStale,
  signInStoreLockWord,
  signInStorePlatforms,
  signInStoreText,
  signInStoreTokenRead,
} from "../../src/contract/signInStore.ts";

const home = "/home/person";

test("the store is under the configuration directory a person set as a whole path, on every platform, and under their home's .config otherwise", () => {
  assert.equal(
    signInStoreDirectory({ home, configHome: undefined }),
    "/home/person/.config/chuggy/sign-ins",
  );
  assert.equal(
    signInStoreDirectory({ home, configHome: "/xdg/" }),
    "/xdg/chuggy/sign-ins",
  );
  assert.equal(
    signInStoreDirectory({ home, configHome: "xdg" }),
    "/home/person/.config/chuggy/sign-ins",
  );
  assert.deepEqual(signInStorePlatforms, ["linux", "darwin"]);
});

test("a site's file is named by its origin, as one name and no path", () => {
  const name = signInStoreFileName("https://chuggy.example:8443");
  assert.equal(name, "https%3A%2F%2Fchuggy.example%3A8443");
  assert.ok(!name.includes("/"));
  assert.notEqual(name, signInStoreLockName);
});

test("a site's file reads back the token written to it, and anything else as none", () => {
  assert.equal(signInStoreText("renewal-1"), "renewal-1\n");
  assert.equal(signInStoreTokenRead(signInStoreText("renewal-1")), "renewal-1");
  assert.equal(signInStoreTokenRead("renewal-1"), "renewal-1");
  for (const text of ["", "\n", "two words\n", "one\ntwo\n", '{"a":1} x'])
    assert.equal(signInStoreTokenRead(text), undefined, text);
});

test("a draft names the file it is of, and the lock's own draft is no file's", () => {
  const file = signInStoreFileName("https://chuggy.example");
  const draft = signInStoreDraftName(file, 4242);
  assert.equal(signInStoreDraftOf(draft), file);
  assert.equal(signInStoreDraftOf(file), undefined);
  assert.equal(
    signInStoreDraftOf(signInStoreDraftName(signInStoreLockName, 4242)),
    undefined,
  );
  assert.equal(signInStoreDraftOf(`${file}.x.draft`), undefined);
});

test("a lock's word names its holder, and is nobody's once that holder is gone or past the longest hold", () => {
  const word = signInStoreLockWord(4242, 1_000.7);
  assert.deepEqual(signInStoreLockHolder(word), {
    pid: 4242,
    takenAtMs: 1_000,
  });
  const alive = (pid: number) => pid === 4242;
  assert.equal(signInStoreLockStale(word, 2_000, alive), false);
  assert.equal(
    signInStoreLockStale(word, 1_000 + signInStoreLockSecsMax * 1_000, alive),
    false,
  );
  assert.equal(
    signInStoreLockStale(word, 1_001 + signInStoreLockSecsMax * 1_000, alive),
    true,
  );
  assert.equal(
    signInStoreLockStale(word, 2_000, () => false),
    true,
  );
  for (const other of ["free", "0.1", "x.1", "1", ".DS_Store"])
    assert.equal(signInStoreLockStale(other, 2_000, alive), true, other);
});

const origin = "https://chug.gy";

const records = [
  ["access", signInStoreAccessName],
  ["ended", signInStoreEndedName],
] as const;

test("neither record's name is the lock's, a draft, or the file of any origin, an origin with the record's word added included", () => {
  for (const [word, named] of records) {
    const name = named(origin);
    assert.notEqual(name, signInStoreLockName, word);
    assert.equal(signInStoreDraftOf(name), undefined, word);
    assert.equal(decodeURIComponent(name), `${origin}+${word}`, word);
    for (const other of [
      origin,
      `${origin}.${word}`,
      `${origin}+${word}`,
      `${origin}%2B${word}`,
      decodeURIComponent(name),
    ])
      assert.notEqual(name, signInStoreFileName(other), other);
    assert.ok(/[^A-Za-z0-9\-_.!~*'()%]/u.test(name), word);
  }
  assert.notEqual(signInStoreAccessName(origin), signInStoreEndedName(origin));
});

test("a draft of either record reads as that record's", () => {
  for (const [word, named] of records)
    assert.equal(
      signInStoreDraftOf(signInStoreDraftName(named(origin), 4242)),
      named(origin),
      word,
    );
});

function digest(token: string): string {
  return createHash(signInStoreAccessDigest).update(token).digest("hex");
}

const access = {
  accessToken: "access-1",
  expiresAtMs: 1_800_000_000_000,
  renewalDigest: digest("renewal-1"),
};

test("an access record reads back its token and expiry, holds no renewal token, and is taken only with the renewal token it was issued with", () => {
  const text = signInStoreAccessText(access);
  assert.ok(!text.includes("renewal-1"));
  assert.deepEqual(signInStoreAccessRead(text, digest("renewal-1")), {
    accessToken: "access-1",
    expiresAtMs: 1_800_000_000_000,
  });
  assert.equal(signInStoreAccessRead(text, digest("renewal-2")), undefined);
  assert.equal(signInStoreAccessRead(text, "renewal-1"), undefined);
});

test("an access record that is empty, cut short, past its bounds or misshapen reads as absent", () => {
  const text = signInStoreAccessText(access);
  const renewal = digest("renewal-1");
  for (const other of [
    "",
    "\n",
    text.slice(0, -1),
    text.slice(0, text.length / 2),
    `${JSON.stringify({ ...access, accessToken: "a".repeat(8193) })}\n`,
    `${JSON.stringify({ ...access, accessToken: "two words" })}\n`,
    `${JSON.stringify({ ...access, expiresAtMs: -1 })}\n`,
    `${JSON.stringify({ ...access, renewalDigest: renewal.toUpperCase() })}\n`,
    `${JSON.stringify({ ...access, refreshToken: "renewal-1" })}\n`,
    `${JSON.stringify({ accessToken: "access-1", renewalDigest: renewal })}\n`,
    "access-1\n",
  ])
    assert.equal(signInStoreAccessRead(other, renewal), undefined, other);
});

const ended = {
  endedAtMs: 1_800_000_000_000,
  error: "invalid_grant",
  errorDescription:
    "The provided authorization grant is invalid, expired, revoked.",
};

test("an ended record reads back when the issuer refused and what it said, with or without a description", () => {
  assert.deepEqual(signInStoreEndedRead(signInStoreEndedText(ended)), ended);
  const bare = { endedAtMs: 0, error: "invalid_grant" };
  assert.deepEqual(signInStoreEndedRead(signInStoreEndedText(bare)), bare);
});

test("the ended record's writer cuts what is too long and drops what section 5.2 does not allow, and keeps no more", () => {
  const fitted = signInStoreEndedRead(
    signInStoreEndedText({
      endedAtMs: 1,
      error: `invalid_grant"\\${"e".repeat(signInStoreEndedErrorCharsMax)}`,
      errorDescription: `“The token”\nwas\tspent.${"d".repeat(signInStoreEndedDescriptionCharsMax)}`,
    }),
  );
  assert.equal(fitted?.error.length, signInStoreEndedErrorCharsMax);
  assert.ok(fitted?.error.startsWith("invalid_grante"));
  assert.equal(
    fitted?.errorDescription?.length,
    signInStoreEndedDescriptionCharsMax,
  );
  assert.ok(fitted?.errorDescription?.startsWith("The tokenwasspent.d"));
});

test("an ended record that is empty, cut short, past its bounds, misshapen or holding a character section 5.2 does not allow reads as absent", () => {
  const text = signInStoreEndedText(ended);
  const raw = (fields: object) =>
    `${JSON.stringify({ ...ended, ...fields })}\n`;
  for (const other of [
    "",
    "\n",
    text.slice(0, -1),
    text.slice(0, text.length / 2),
    raw({ error: "e".repeat(signInStoreEndedErrorCharsMax + 1) }),
    raw({
      errorDescription: "d".repeat(signInStoreEndedDescriptionCharsMax + 1),
    }),
    raw({ error: 'invalid"grant' }),
    raw({ errorDescription: "back\\slash" }),
    raw({ errorDescription: "new\nline" }),
    raw({ errorDescription: "“quoted”" }),
    raw({ endedAtMs: 1.5 }),
    raw({ refreshToken: "renewal-1" }),
    `${JSON.stringify({ error: "invalid_grant" })}\n`,
  ])
    assert.equal(signInStoreEndedRead(other), undefined, other);
});
