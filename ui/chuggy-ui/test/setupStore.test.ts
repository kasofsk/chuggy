/**
 * What the setup program keeps between runs, as values: what is remembered
 * and nothing more, the lock and how it changes hands, and the note a sign-in
 * page leaves.
 */

import { expect, test } from "vitest";

import { sessionRefreshTokenKey } from "../app/core/sessionHolder.ts";
import { setupFiles } from "../app/core/setupPorts.ts";
import type {
  SetupFile,
  SetupFilesPort,
  SetupLockPort,
} from "../app/core/setupPorts.ts";
import { setupSignInEndings } from "../app/core/setupReport.ts";
import type { SetupSignInEnded } from "../app/core/setupReport.ts";
import {
  setupSignInFound,
  setupSignInGraceSecs,
  setupSignInKeptSecs,
  setupSignInStood,
} from "../app/core/setupSignIn.ts";
import {
  setupLockHeldBy,
  setupLockReleased,
  setupLockRetryMs,
  setupLockSecsMax,
  setupLockStale,
  setupLockTaken,
  setupLockWord,
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
  /** Each file whose unfinished writes were asked to be removed. */
  readonly swept: SetupFile[];
}

function held(session?: string): Held {
  const texts = new Map<SetupFile, string>();
  if (session !== undefined) texts.set(setupFiles.session, session);
  const writes: SetupFile[] = [];
  const swept: SetupFile[] = [];
  return {
    texts,
    writes,
    swept,
    files: {
      read: (file) => texts.get(file),
      write: (file, text) => {
        writes.push(file);
        texts.set(file, text);
      },
      remove: (file) => {
        texts.delete(file);
      },
      sweep: (file) => {
        swept.push(file);
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
  const holding = setupTokenStore(files, site, "renewal-1");
  expect(holding.read("chuggy.authorization")).toBeNull();
});

const nowMs = 5_000_000;

test("a word is nobody's when it is not a holder's, its holder is gone, or it is older than any run", () => {
  const alive = (pid: number) => pid === 7;
  expect(setupLockStale(setupLockWord(7, nowMs), nowMs, alive)).toBe(false);
  expect(setupLockStale(setupLockWord(8, nowMs), nowMs, alive)).toBe(true);
  for (const word of ["", "7", "7.", ".7", "seven.5000000", "7.5000000.1"])
    expect(setupLockStale(word, nowMs, alive), word).toBe(true);
  expect(setupLockStale(`0.${String(nowMs)}`, nowMs, () => true)).toBe(true);
  const oldest = nowMs - setupLockSecsMax * 1_000;
  expect(setupLockStale(setupLockWord(7, oldest), nowMs, alive)).toBe(false);
  expect(setupLockStale(setupLockWord(7, oldest - 1), nowMs, alive)).toBe(true);
});

interface Cell {
  said: string | undefined;
  /** Runs as a lock is read, before the reader is answered, which is where another run can come between a read and the swap after it. */
  between: () => void;
  readonly port: SetupLockPort;
}

function cell(said?: string): Cell {
  const held: Cell = {
    said,
    between: () => undefined,
    port: {
      read: () => {
        const read = held.said;
        held.between();
        return read;
      },
      swap: (from, next) => {
        if (held.said !== from) return false;
        held.said = next;
        return true;
      },
    },
  };
  return held;
}

function locker(
  lock: Cell,
  pid: number,
  alive: readonly number[],
  clockMs = nowMs,
) {
  const slept: number[] = [];
  const { files, swept } = held();
  return {
    slept,
    swept,
    ports: {
      files,
      lock: lock.port,
      nowMs: () => clockMs,
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

test("a free lock is taken at once, and says whose it is and when", async () => {
  const lock = cell();
  const mine = locker(lock, 11, [11]);
  expect(await setupLockTaken(mine.ports, 1_000)).toBe(true);
  expect(lock.said).toBe(setupLockWord(11, nowMs));
  expect(lock.said).toBe("11.5000000");
  expect(mine.slept).toEqual([]);
});

test("a lock a running command holds is waited for no longer than the wait, and is left as it was", async () => {
  const lock = cell();
  expect(await setupLockTaken(locker(lock, 7, [7]).ports, 0)).toBe(true);
  const second = locker(lock, 11, [7, 11]);
  expect(await setupLockTaken(second.ports, 1_000)).toBe(false);
  expect(second.slept).toEqual(
    Array.from({ length: 1_000 / setupLockRetryMs }, () => setupLockRetryMs),
  );
  expect(lock.said).toBe(setupLockWord(7, nowMs));
});

test("a lock nobody holds is taken from the word it says", async () => {
  const lock = cell(setupLockWord(7, nowMs));
  expect(await setupLockTaken(locker(lock, 11, [11]).ports, 0)).toBe(true);
  expect(lock.said).toBe(setupLockWord(11, nowMs));
});

test("of two runs that both read a lock nobody holds, the one whose swap comes second does not take it", async () => {
  const lock = cell(setupLockWord(7, nowMs));
  const first = locker(lock, 11, [11, 12]);
  const second = locker(lock, 12, [11, 12]);
  let overtaken: Promise<boolean> | undefined;
  lock.between = () => {
    lock.between = () => undefined;
    overtaken = setupLockTaken(second.ports, 0);
  };
  expect(await setupLockTaken(first.ports, 0)).toBe(false);
  expect(await overtaken).toBe(true);
  expect(lock.said).toBe(setupLockWord(12, nowMs));
});

test("a clock that reads between two milliseconds still writes a word that is its holder's", async () => {
  const lock = cell();
  const mine = locker(lock, 11, [11], nowMs + 0.5);
  expect(await setupLockTaken(mine.ports, 0)).toBe(true);
  expect(lock.said).toBe(setupLockWord(11, nowMs));
  expect(await setupLockTaken(locker(lock, 12, [11, 12]).ports, 0)).toBe(false);
});

test("taking the lock removes what a write of the remembered sign-in left unfinished, and not taking it removes nothing", async () => {
  const lock = cell();
  const first = locker(lock, 7, [7]);
  expect(await setupLockTaken(first.ports, 0)).toBe(true);
  expect(first.swept).toEqual([setupFiles.session]);
  const second = locker(lock, 11, [7, 11]);
  expect(await setupLockTaken(second.ports, 0)).toBe(false);
  expect(second.swept).toEqual([]);
});

test("a run that did not get the lock is told which process it names, and nothing where it names none", () => {
  const lock = cell();
  const asking = locker(lock, 11, [7, 11]).ports;
  expect(setupLockHeldBy(asking)).toBeUndefined();
  lock.said = setupLockWord(7, nowMs);
  expect(setupLockHeldBy(asking)).toBe(7);
  lock.said = "left by hand";
  expect(setupLockHeldBy(asking)).toBeUndefined();
});

test("a run gives up its own lock and nobody else's", () => {
  const lock = cell(setupLockWord(7, nowMs));
  setupLockReleased(locker(lock, 11, [7, 11]).ports);
  expect(lock.said).toBe(setupLockWord(7, nowMs));
  setupLockReleased(locker(lock, 7, [7, 11]).ports);
  expect(lock.said).toBeUndefined();
  setupLockReleased(locker(lock, 7, [7, 11]).ports);
  expect(lock.said).toBeUndefined();
});

const waiting: SetupSignInNote = {
  note: "Waiting",
  site,
  port: 41001,
  pid: 7,
  endsAtMs: nowMs + 60_000,
};

function endedNote(
  ended: SetupSignInEnded,
  told = false,
): Extract<SetupSignInNote, { readonly note: "Ended" }> {
  return { note: "Ended", site, ended, endedAtMs: nowMs, told };
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
  setupSignInNoteWritten(files, endedNote("Declined", true));
  expect(setupSignInNoteRead(files)).toEqual(endedNote("Declined", true));
  const untold = { note: "Ended", site, ended: "Declined", endedAtMs: nowMs };
  texts.set(setupFiles.signIn, JSON.stringify(untold));
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

test("an ending is a sign-in's to report while it is recent, was not a sign-in, and no sign-in has reported it", () => {
  const alive = () => false;
  const keptMs = setupSignInKeptSecs * 1_000;
  const declined = endedNote("Declined");
  expect(setupSignInFound(declined, site, nowMs + keptMs, alive)).toEqual({
    found: "Ended",
    note: declined,
  });
  for (const gone of [
    setupSignInFound(declined, site, nowMs + keptMs + 1, alive),
    setupSignInFound(endedNote("SignedIn"), site, nowMs, alive),
    setupSignInFound(endedNote("Declined", true), site, nowMs, alive),
    setupSignInFound(declined, "https://elsewhere.example", nowMs, alive),
  ])
    expect(gone).toEqual({ found: "None" });
});

test("an ending stands for its own site, told or not and however old, where nothing is run after it until the person asks", () => {
  const stood = Object.fromEntries(
    setupSignInEndings.map((ended) => [
      ended,
      setupSignInStood(endedNote(ended), site),
    ]),
  );
  expect(stood).toEqual({
    SignedIn: undefined,
    SiteChanged: undefined,
    WorkspacesUnread: undefined,
    NoRenewal: "NoRenewal",
    Declined: "Declined",
    Refused: "Refused",
    Mismatched: "Mismatched",
    ExchangeFailed: "ExchangeFailed",
    SiteRefused: "SiteRefused",
    Expired: "Expired",
    SiteUnusable: "SiteUnusable",
    Busy: "Busy",
    Faulted: "Faulted",
  });
  expect(setupSignInStood(endedNote("Declined", true), site)).toBe("Declined");
  expect(
    setupSignInStood({ ...endedNote("Declined"), endedAtMs: 0 }, site),
  ).toBe("Declined");
  expect(
    setupSignInStood(endedNote("Declined"), "https://elsewhere.example"),
  ).toBeUndefined();
  expect(setupSignInStood(waiting, site)).toBeUndefined();
  expect(setupSignInStood(undefined, site)).toBeUndefined();
});
