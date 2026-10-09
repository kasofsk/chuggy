/**
 * The setup program's files as values: what is remembered and nothing more,
 * the lock and when it is nobody's, and the note a sign-in page leaves.
 */

import { expect, test } from "vitest";

import { sessionRefreshTokenKey } from "../app/core/sessionHolder.ts";
import { setupFiles } from "../app/core/setupPorts.ts";
import type { SetupFile, SetupFilesPort } from "../app/core/setupPorts.ts";
import {
  setupSignInFound,
  setupSignInGraceSecs,
  setupSignInKeptSecs,
} from "../app/core/setupSignIn.ts";
import {
  setupLockReleased,
  setupLockRetryMs,
  setupLockSecsMax,
  setupLockStale,
  setupLockTaken,
  setupSessionRead,
  setupSessionWritten,
  setupSignInNoteRead,
  setupSignInNoteWritten,
  setupTokenStore,
} from "../app/core/setupStore.ts";
import type { SetupSignInNote } from "../app/core/setupStore.ts";

const site = "https://chuggy.example";

interface Held {
  readonly files: SetupFilesPort;
  readonly texts: Map<SetupFile, string>;
  /** How many times each file was written whole. */
  readonly writes: SetupFile[];
}

function held(session?: string): Held {
  const texts = new Map<SetupFile, string>();
  if (session !== undefined) texts.set(setupFiles.session, session);
  const writes: SetupFile[] = [];
  return {
    texts,
    writes,
    files: {
      read: (file) => texts.get(file),
      write: (file, text) => {
        writes.push(file);
        texts.set(file, text);
      },
      create: (file, text) => {
        if (texts.has(file)) return false;
        texts.set(file, text);
        return true;
      },
      remove: (file) => {
        texts.delete(file);
      },
    },
  };
}

test("what is remembered is a site and the renewal token for it, and nothing else", () => {
  const { files, texts } = held();
  setupSessionWritten(files, { site, refreshToken: "renewal-1" });
  expect(JSON.parse(texts.get(setupFiles.session) ?? "")).toEqual({
    site,
    refreshToken: "renewal-1",
  });
  expect(setupSessionRead(files)).toEqual({ site, refreshToken: "renewal-1" });
  setupSessionWritten(files, { site, refreshToken: undefined });
  expect(JSON.parse(texts.get(setupFiles.session) ?? "")).toEqual({ site });
  expect(setupSessionRead(files)).toEqual({ site, refreshToken: undefined });
});

test.each([
  ["no file", undefined],
  ["not JSON", "{"],
  ["another shape", JSON.stringify({ origin: site })],
  [
    "a field this program never wrote",
    JSON.stringify({ site, accessToken: "a" }),
  ],
  ["a site that is not an origin", JSON.stringify({ site: `${site}/acme` })],
  ["an empty token", JSON.stringify({ site, refreshToken: "" })],
])("a remembered sign-in that is %s is read as none", (_name, text) => {
  expect(setupSessionRead(held(text).files)).toBeUndefined();
});

test("the holder's store reads the token it was opened with and writes each one after it to the file at once", () => {
  const { files, texts, writes } = held();
  const store = setupTokenStore(files, site, "renewal-1");
  expect(store.read(sessionRefreshTokenKey)).toBe("renewal-1");
  expect(writes).toEqual([]);
  store.write(sessionRefreshTokenKey, "renewal-2");
  expect(JSON.parse(texts.get(setupFiles.session) ?? "")).toEqual({
    site,
    refreshToken: "renewal-2",
  });
  expect(store.read(sessionRefreshTokenKey)).toBe("renewal-2");
  store.remove(sessionRefreshTokenKey);
  expect(JSON.parse(texts.get(setupFiles.session) ?? "")).toEqual({ site });
  expect(store.read(sessionRefreshTokenKey)).toBeNull();
});

test("the holder's store keeps nothing but the renewal token", () => {
  const { files, writes } = held();
  const store = setupTokenStore(files, site, undefined);
  store.write("chuggy.authorization", "verifier");
  store.remove("chuggy.authorization");
  store.remove(sessionRefreshTokenKey);
  expect(store.read("chuggy.authorization")).toBeNull();
  expect(writes).toEqual([]);
});

const nowMs = 5_000_000;

function lockText(pid: number, takenAtMs: number): string {
  return JSON.stringify({ pid, takenAtMs });
}

test("a lock is nobody's when it is unreadable, its holder is gone, or it is older than any run", () => {
  const alive = (pid: number) => pid === 7;
  expect(setupLockStale(lockText(7, nowMs), nowMs, alive)).toBe(false);
  expect(setupLockStale(lockText(8, nowMs), nowMs, alive)).toBe(true);
  expect(setupLockStale(undefined, nowMs, alive)).toBe(true);
  expect(setupLockStale("", nowMs, alive)).toBe(true);
  expect(setupLockStale(JSON.stringify({ pid: "7" }), nowMs, alive)).toBe(true);
  const oldest = nowMs - setupLockSecsMax * 1_000;
  expect(setupLockStale(lockText(7, oldest), nowMs, alive)).toBe(false);
  expect(setupLockStale(lockText(7, oldest - 1), nowMs, alive)).toBe(true);
});

function locker(files: SetupFilesPort, pid: number, alive: readonly number[]) {
  const slept: number[] = [];
  return {
    slept,
    ports: {
      files,
      nowMs: () => nowMs,
      sleepMs: (ms: number) => {
        slept.push(ms);
        return Promise.resolve();
      },
      process: {
        pid,
        alive: (asked: number) => alive.includes(asked),
        detach: () => undefined,
        launch: () => Promise.resolve({ launched: "Unstarted" } as const),
      },
    },
  };
}

test("a free lock is taken at once, and holds whose it is and when", async () => {
  const { files, texts } = held();
  const mine = locker(files, 11, [11]);
  expect(await setupLockTaken(mine.ports, 1_000)).toBe(true);
  expect(texts.get(setupFiles.lock)).toBe(lockText(11, nowMs));
  expect(mine.slept).toEqual([]);
});

test("a lock a running command holds is waited for no longer than the wait, and is left as it was", async () => {
  const { files, texts } = held();
  expect(await setupLockTaken(locker(files, 7, [7]).ports, 0)).toBe(true);
  const second = locker(files, 11, [7, 11]);
  expect(await setupLockTaken(second.ports, 1_000)).toBe(false);
  expect(second.slept).toEqual(
    Array.from({ length: 1_000 / setupLockRetryMs }, () => setupLockRetryMs),
  );
  expect(texts.get(setupFiles.lock)).toBe(lockText(7, nowMs));
});

test("a lock nobody holds is removed and taken", async () => {
  const { files, texts } = held();
  texts.set(setupFiles.lock, lockText(7, nowMs));
  expect(await setupLockTaken(locker(files, 11, [11]).ports, 0)).toBe(true);
  expect(texts.get(setupFiles.lock)).toBe(lockText(11, nowMs));
});

test("a run gives up its own lock and nobody else's", () => {
  const { files, texts } = held();
  texts.set(setupFiles.lock, lockText(7, nowMs));
  setupLockReleased(locker(files, 11, [7, 11]).ports);
  expect(texts.has(setupFiles.lock)).toBe(true);
  setupLockReleased(locker(files, 7, [7, 11]).ports);
  expect(texts.has(setupFiles.lock)).toBe(false);
});

const waiting: SetupSignInNote = {
  note: "Waiting",
  site,
  port: 41001,
  pid: 7,
  endsAtMs: nowMs + 60_000,
};

function endedNote(ended: "Declined" | "SignedIn"): SetupSignInNote {
  return { note: "Ended", site, ended, endedAtMs: nowMs };
}

test("a note is read back as it was written, and anything else as none", () => {
  const { files, texts } = held();
  expect(setupSignInNoteRead(files)).toBeUndefined();
  setupSignInNoteWritten(files, waiting);
  expect(setupSignInNoteRead(files)).toEqual(waiting);
  texts.set(setupFiles.signIn, JSON.stringify({ ...waiting, code: "x" }));
  expect(setupSignInNoteRead(files)).toBeUndefined();
  texts.set(
    setupFiles.signIn,
    JSON.stringify({ ...endedNote("Declined"), ended: "Hacked" }),
  );
  expect(setupSignInNoteRead(files)).toBeUndefined();
});

test("a page is still waiting while its listener runs and its end, with a little grace, has not passed", () => {
  const alive = (pid: number) => pid === 7;
  const found = { found: "Waiting", port: 41001, pid: 7 };
  const graceMs = setupSignInGraceSecs * 1_000;
  expect(setupSignInFound(waiting, site, nowMs, alive)).toEqual(found);
  expect(
    setupSignInFound(waiting, site, waiting.endsAtMs + graceMs, alive),
  ).toEqual(found);
  for (const gone of [
    setupSignInFound(waiting, site, waiting.endsAtMs + graceMs + 1, alive),
    setupSignInFound(waiting, site, nowMs, () => false),
    setupSignInFound(waiting, "https://elsewhere.example", nowMs, alive),
    setupSignInFound(undefined, site, nowMs, alive),
  ])
    expect(gone).toEqual({ found: "None" });
});

test("an ending is worth saying while it is recent and was not a sign-in", () => {
  const alive = () => false;
  const keptMs = setupSignInKeptSecs * 1_000;
  const declined = endedNote("Declined");
  expect(setupSignInFound(declined, site, nowMs + keptMs, alive)).toEqual({
    found: "Ended",
    ended: "Declined",
  });
  expect(setupSignInFound(declined, site, nowMs + keptMs + 1, alive)).toEqual({
    found: "None",
  });
  expect(setupSignInFound(endedNote("SignedIn"), site, nowMs, alive)).toEqual({
    found: "None",
  });
});
