/**
 * The shared sign-in store as each program that keeps a sign-in in it reads
 * it: where it is on each platform, what a site's file holds, which names are
 * drafts a lock holder removes, and when a lock is nobody's.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  signInStoreDirectory,
  signInStoreDraftName,
  signInStoreDraftOf,
  signInStoreFileName,
  signInStoreLockHolder,
  signInStoreLockName,
  signInStoreLockSecsMax,
  signInStoreLockStale,
  signInStoreLockWord,
  signInStoreText,
  signInStoreTokenRead,
} from "../../src/contract/signInStore.ts";

const home = "/home/person";

test("the store is under the configuration directory a Linux person set, and under their home's .config otherwise", () => {
  assert.equal(
    signInStoreDirectory({ platform: "linux", home, configHome: undefined }),
    "/home/person/.config/chuggy/sign-ins",
  );
  assert.equal(
    signInStoreDirectory({ platform: "linux", home, configHome: "/xdg/" }),
    "/xdg/chuggy/sign-ins",
  );
  assert.equal(
    signInStoreDirectory({ platform: "linux", home, configHome: "xdg" }),
    "/home/person/.config/chuggy/sign-ins",
  );
  assert.equal(
    signInStoreDirectory({ platform: "darwin", home, configHome: "/xdg" }),
    "/home/person/.config/chuggy/sign-ins",
  );
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
