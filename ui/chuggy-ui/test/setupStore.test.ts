/**
 * What the setup program keeps between runs, as values: what is remembered
 * and nothing more, the lock and how it changes hands, and the note a sign-in
 * page leaves.
 */

import { expect, test } from "vitest";

import {
  signInStoreAccessName,
  signInStoreEndedName,
  signInStoreFileName,
  signInStoreLockSecsMax,
  signInStoreLockStale,
  signInStoreLockWord,
  signInStorePendingName,
  signInStoreText,
} from "../../../src/contract/signInStore.ts";
import { sessionRefreshTokenKey } from "../app/core/sessionHolder.ts";
import { setupFiles, SetupMachineError } from "../app/core/setupPorts.ts";
import type {
  SetupFile,
  SetupFilesPort,
  SetupLockPort,
  SetupStorePort,
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
  setupLockTaken,
  setupSessionMoved,
  setupSessionRoomBytes,
  setupSessionSite,
  setupSessionSiteWritten,
  setupSignInNoteRead,
  setupSignInNoteWritten,
  setupTokenRead,
  setupTokenRemoved,
  setupTokenStore,
} from "../app/core/setupStore.ts";
import type { SetupSignInNote } from "../app/core/setupStore.ts";

const site = "https://chuggy.example";

/** The site's file in the shared store. */
const siteFile = signInStoreFileName(site);

/** What the swept log says for a sweep of the shared store, which is of every file in it. */
const storeSwept = "store";

interface Held {
  readonly files: SetupFilesPort;
  readonly store: SetupStorePort;
  readonly texts: Map<SetupFile, string>;
  readonly stored: Map<string, string>;
  /** Each file of either that was written whole. */
  readonly writes: string[];
  /** Each file whose unfinished writes were asked to be removed, the store's as `storeSwept`. */
  readonly swept: string[];
  /** Each file room was asked for, with how much. */
  readonly reserved: (readonly [string, number])[];
  /** What the machine refuses from here on: room, a write, a sweep, the removal of one file in the store, or nothing. */
  refuses:
    "Room" | "Write" | "Sweep" | { readonly removing: string } | undefined;
}

const storeDirectory = "/home/person/.config/chuggy/sign-ins";

const storePath = `${storeDirectory}/${siteFile}`;

function unwritable(path = storePath): SetupMachineError {
  return new SetupMachineError({ fault: "Unwritable", path });
}

function held(session?: string, token?: string): Held {
  const texts = new Map<SetupFile, string>();
  if (session !== undefined) texts.set(setupFiles.session, session);
  const stored = new Map<string, string>();
  if (token !== undefined) stored.set(siteFile, token);
  const writing = (name: string): void => {
    if (kept.refuses === "Write") throw unwritable();
    kept.writes.push(name);
  };
  const sweeping = (name: string): void => {
    kept.swept.push(name);
    if (kept.refuses === "Sweep") throw unwritable();
  };
  const kept: Held = {
    texts,
    stored,
    writes: [],
    swept: [],
    reserved: [],
    refuses: undefined,
    files: {
      read: (file) => texts.get(file),
      write: (file, text) => {
        writing(file);
        texts.set(file, text);
      },
      reserve: (file, bytes) => {
        kept.reserved.push([file, bytes]);
        if (kept.refuses === "Room") throw unwritable();
      },
      remove: (file) => {
        texts.delete(file);
      },
      sweep: sweeping,
    },
    store: {
      read: (name) => stored.get(name),
      write: (name, text) => {
        writing(name);
        stored.set(name, text);
      },
      reserve: (name, bytes) => {
        kept.reserved.push([name, bytes]);
        if (kept.refuses === "Room") throw unwritable();
      },
      remove: (name) => {
        if (typeof kept.refuses === "object" && kept.refuses.removing === name)
          throw unwritable(`${storeDirectory}/${name}`);
        writing(name);
        stored.delete(name);
      },
      sweep: () => {
        sweeping(storeSwept);
      },
    },
  };
  return kept;
}

test("what the program's own directory remembers is a site, and nothing else", () => {
  const { files, texts } = held();
  setupSessionSiteWritten(files, site);
  expect(JSON.parse(texts.get(setupFiles.session) ?? "")).toEqual({ site });
  expect(setupSessionSite(files)).toBe(site);
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
])("a remembered site that is %s is read as none", (_name, text) => {
  expect(setupSessionSite(held(text).files)).toBeUndefined();
});

test("the sign-in is the token the shared store holds for the site, as the contract writes it, and nothing it did not write", () => {
  expect(setupTokenRead(held(undefined, "renewal-1\n").store, site)).toBe(
    "renewal-1",
  );
  expect(
    setupTokenRead(
      held(undefined, "renewal-1\n").store,
      "https://other.example",
    ),
  ).toBeUndefined();
  for (const text of ["", "two words\n", "one\ntwo\n"])
    expect(setupTokenRead(held(undefined, text).store, site), text).toBe(
      undefined,
    );
});

test("a token an older copy kept beside the site is moved into the shared store once, and the site stays remembered", () => {
  const kept = held(JSON.stringify({ site, refreshToken: "renewal-old" }));
  setupSessionMoved(kept.files, kept.store);
  expect(kept.stored.get(siteFile)).toBe(signInStoreText("renewal-old"));
  expect(JSON.parse(kept.texts.get(setupFiles.session) ?? "")).toEqual({
    site,
  });
  expect(setupSessionSite(kept.files)).toBe(site);
  kept.writes.length = 0;
  kept.stored.set(siteFile, signInStoreText("renewal-new"));
  setupSessionMoved(kept.files, kept.store);
  expect(kept.writes).toEqual([]);
  expect(setupTokenRead(kept.store, site)).toBe("renewal-new");
});

test("a token an older copy kept is dropped where the shared store already holds the site's sign-in, which is the one kept", () => {
  const kept = held(
    JSON.stringify({ site, refreshToken: "renewal-old" }),
    signInStoreText("renewal-mcp"),
  );
  setupSessionMoved(kept.files, kept.store);
  expect(setupTokenRead(kept.store, site)).toBe("renewal-mcp");
  expect(JSON.parse(kept.texts.get(setupFiles.session) ?? "")).toEqual({
    site,
  });
});

test("nothing is moved where the program's directory holds no token or nothing it wrote", () => {
  for (const text of [undefined, JSON.stringify({ site }), "{"]) {
    const kept = held(text);
    setupSessionMoved(kept.files, kept.store);
    expect(kept.writes, String(text)).toEqual([]);
    expect(kept.stored.size).toBe(0);
  }
});

test("the holder's store reads the token it was opened with and writes each one after it to the site's file in the shared store at once", () => {
  const { store: shared, stored, writes } = held();
  const store = setupTokenStore(shared, site, "renewal-1");
  expect(store.read(sessionRefreshTokenKey)).toBe("renewal-1");
  expect(writes).toEqual([]);
  store.write(sessionRefreshTokenKey, "renewal-2");
  expect(stored.get(siteFile)).toBe(signInStoreText("renewal-2"));
  expect(store.read(sessionRefreshTokenKey)).toBe("renewal-2");
  store.remove(sessionRefreshTokenKey);
  expect(stored.has(siteFile)).toBe(false);
  expect(store.read(sessionRefreshTokenKey)).toBeNull();
});

test("the holder's store keeps nothing but the renewal token", () => {
  const { store: shared, writes } = held();
  const store = setupTokenStore(shared, site, undefined);
  store.write("chuggy.authorization", "verifier");
  store.remove("chuggy.authorization");
  store.remove(sessionRefreshTokenKey);
  expect(store.read("chuggy.authorization")).toBeNull();
  expect(writes).toEqual([]);
  const holding = setupTokenStore(shared, site, "renewal-1");
  expect(holding.read("chuggy.authorization")).toBeNull();
});

const room = [siteFile, setupSessionRoomBytes] as const;

test("room is kept for one write of the remembered sign-in at a time: once before a write, and again only after one took it", () => {
  const kept = held();
  const store = setupTokenStore(kept.store, site, "renewal-1");
  expect(kept.reserved).toEqual([]);
  store.roomed();
  store.roomed();
  expect(kept.reserved).toEqual([room]);
  store.write(sessionRefreshTokenKey, "renewal-2");
  store.roomed();
  expect(kept.reserved).toEqual([room, room]);
  store.remove(sessionRefreshTokenKey);
  store.roomed();
  store.roomed();
  expect(kept.reserved).toEqual([room, room, room]);
  expect(() => {
    store.kept();
  }).not.toThrow();
});

/** What a call threw, as the machine's own word for it. */
function fault(call: () => void): unknown {
  try {
    call();
  } catch (failure: unknown) {
    return failure instanceof SetupMachineError ? failure.fault : failure;
  }
  return undefined;
}

test("room the machine would not give is thrown as the path, when it is asked for and again by whoever asks what the store was refused", () => {
  const kept = held();
  const store = setupTokenStore(kept.store, site, "renewal-1");
  kept.refuses = "Room";
  const refused = { fault: "Unwritable", path: storePath };
  expect(fault(store.roomed)).toEqual(refused);
  expect(fault(store.kept)).toEqual(refused);
  kept.refuses = undefined;
  store.roomed();
  expect(kept.reserved).toEqual([room, room]);
  expect(fault(store.kept)).toEqual(refused);
});

test("a token the machine would not write is a sign-in that was not kept, with the path, to the holder that wrote it and to whoever asks afterwards", () => {
  const kept = held();
  const store = setupTokenStore(kept.store, site, "renewal-1");
  store.roomed();
  kept.refuses = "Write";
  const unkept = { fault: "Unkept", path: storePath };
  expect(
    fault(() => {
      store.write(sessionRefreshTokenKey, "renewal-2");
    }),
  ).toEqual(unkept);
  expect(fault(store.kept)).toEqual(unkept);
  expect(kept.stored.get(siteFile)).toBeUndefined();
});

test("a sign-in the machine would not forget is the path it would not write, and no token is said to be lost", () => {
  const kept = held();
  const store = setupTokenStore(kept.store, site, "renewal-1");
  kept.refuses = "Write";
  const refused = { fault: "Unwritable", path: storePath };
  expect(
    fault(() => {
      store.remove(sessionRefreshTokenKey);
    }),
  ).toEqual(refused);
  expect(fault(store.kept)).toEqual(refused);
});

test("what the store was first refused is what it goes on saying, whatever it is refused afterwards: a forgetting that fails after a token was lost is thrown as the token that was lost", () => {
  const kept = held();
  const store = setupTokenStore(kept.store, site, "renewal-1");
  const unkept = { fault: "Unkept", path: storePath };
  kept.refuses = "Write";
  fault(() => {
    store.write(sessionRefreshTokenKey, "renewal-2");
  });
  expect(
    fault(() => {
      store.remove(sessionRefreshTokenKey);
    }),
  ).toEqual(unkept);
  kept.refuses = "Room";
  expect(fault(store.roomed)).toEqual(unkept);
  expect(fault(store.kept)).toEqual(unkept);
});

test("something the files threw that is no path of the machine's is thrown again as it was", () => {
  const kept = held();
  const odd = new Error("not the machine's");
  const store = setupTokenStore(
    {
      ...kept.store,
      write: () => {
        throw odd;
      },
    },
    site,
    "renewal-1",
  );
  expect(
    fault(() => {
      store.write(sessionRefreshTokenKey, "renewal-2");
    }),
  ).toBe(odd);
  expect(fault(store.kept)).toBe(odd);
});

const other = "https://other.example";

/** The records the shared store keeps beside a site's token, for `site` and for `other`. */
const records = [
  signInStoreAccessName(site),
  signInStoreEndedName(site),
  signInStorePendingName(site),
  signInStoreAccessName(other),
  signInStoreEndedName(other),
  signInStorePendingName(other),
] as const;

/** A machine whose store holds every record for `site` and for `other`, beside whatever `held` is given. */
function recorded(session?: string, token?: string): Held {
  const kept = held(session, token);
  for (const name of records) kept.stored.set(name, "record\n");
  return kept;
}

/** Which of `records` the store still holds. */
function recordsLeft(kept: Held): readonly string[] {
  return records.filter((name) => kept.stored.has(name));
}

const otherRecords = [
  signInStoreAccessName(other),
  signInStoreEndedName(other),
  signInStorePendingName(other),
];

test("every write or removal of a site's token through the holder's store leaves no record for the site, and the other sites' alone", () => {
  for (const step of [
    (store: ReturnType<typeof setupTokenStore>) => {
      store.write(sessionRefreshTokenKey, "renewal-2");
    },
    (store: ReturnType<typeof setupTokenStore>) => {
      store.remove(sessionRefreshTokenKey);
    },
  ]) {
    const kept = recorded(undefined, signInStoreText("renewal-1"));
    const store = setupTokenStore(kept.store, site, "renewal-1");
    step(store);
    expect(recordsLeft(kept)).toEqual(otherRecords);
    expect(kept.writes.slice(1)).toEqual([
      signInStoreAccessName(site),
      signInStorePendingName(site),
      signInStoreEndedName(site),
    ]);
  }
});

test("a token an older copy kept, moved into the shared store, leaves no record for the site, and one the store already held leaves them all", () => {
  const kept = recorded(JSON.stringify({ site, refreshToken: "renewal-old" }));
  setupSessionMoved(kept.files, kept.store);
  expect(recordsLeft(kept)).toEqual(otherRecords);
  const holding = recorded(
    JSON.stringify({ site, refreshToken: "renewal-old" }),
    signInStoreText("renewal-mcp"),
  );
  setupSessionMoved(holding.files, holding.store);
  expect(recordsLeft(holding)).toEqual(records);
});

test("a sign-out removes every record for the site whether or not it held a token, and says only whether it held one", () => {
  const holding = recorded(undefined, signInStoreText("renewal-1"));
  expect(setupTokenRemoved(holding.store, site)).toBe(true);
  expect(holding.stored.has(siteFile)).toBe(false);
  expect(recordsLeft(holding)).toEqual(otherRecords);
  const bare = recorded();
  expect(setupTokenRemoved(bare.store, site)).toBe(false);
  expect(recordsLeft(bare)).toEqual(otherRecords);
});

test("an ended record the machine would not remove after a renewal was written is the path it would not change, never a sign-in that was not kept, and the new token stays", () => {
  const kept = recorded(undefined, signInStoreText("renewal-1"));
  const store = setupTokenStore(kept.store, site, "renewal-1");
  const endedPath = `${storeDirectory}/${signInStoreEndedName(site)}`;
  kept.refuses = { removing: signInStoreEndedName(site) };
  const refused = { fault: "Unwritable", path: endedPath };
  expect(
    fault(() => {
      store.write(sessionRefreshTokenKey, "renewal-2");
    }),
  ).toEqual(refused);
  expect(fault(store.kept)).toEqual(refused);
  expect(kept.stored.get(siteFile)).toBe(signInStoreText("renewal-2"));
  expect(store.read(sessionRefreshTokenKey)).toBe("renewal-2");
  const signingOut = recorded(undefined, signInStoreText("renewal-1"));
  signingOut.refuses = { removing: signInStoreEndedName(site) };
  expect(fault(() => setupTokenRemoved(signingOut.store, site))).toEqual(
    refused,
  );
});

test("an access record the machine would not remove is no fault, since the token it was bound to is gone, and the ended record is removed all the same", () => {
  const kept = recorded(undefined, signInStoreText("renewal-1"));
  const store = setupTokenStore(kept.store, site, "renewal-1");
  kept.refuses = { removing: signInStoreAccessName(site) };
  store.write(sessionRefreshTokenKey, "renewal-2");
  expect(fault(store.kept)).toBeUndefined();
  expect(kept.stored.get(siteFile)).toBe(signInStoreText("renewal-2"));
  expect(recordsLeft(kept)).toEqual([
    signInStoreAccessName(site),
    ...otherRecords,
  ]);
  const signingOut = recorded();
  signingOut.refuses = { removing: signInStoreAccessName(site) };
  expect(setupTokenRemoved(signingOut.store, site)).toBe(false);
  expect(signingOut.stored.has(signInStoreEndedName(site))).toBe(false);
});

test("a pending device sign-in the machine would not remove after a renewal was written, or at a sign-out, is no fault, and the other records are removed all the same", () => {
  const kept = recorded(undefined, signInStoreText("renewal-1"));
  const store = setupTokenStore(kept.store, site, "renewal-1");
  kept.refuses = { removing: signInStorePendingName(site) };
  store.write(sessionRefreshTokenKey, "renewal-2");
  expect(fault(store.kept)).toBeUndefined();
  expect(kept.stored.get(siteFile)).toBe(signInStoreText("renewal-2"));
  expect(recordsLeft(kept)).toEqual([
    signInStorePendingName(site),
    ...otherRecords,
  ]);
  const signingOut = recorded(undefined, signInStoreText("renewal-1"));
  signingOut.refuses = { removing: signInStorePendingName(site) };
  expect(setupTokenRemoved(signingOut.store, site)).toBe(true);
  expect(recordsLeft(signingOut)).toEqual([
    signInStorePendingName(site),
    ...otherRecords,
  ]);
});

const nowMs = 5_000_000;

test("a word is nobody's when it is not a holder's, its holder is gone, or it is older than any run", () => {
  const alive = (pid: number) => pid === 7;
  expect(
    signInStoreLockStale(signInStoreLockWord(7, nowMs), nowMs, alive),
  ).toBe(false);
  expect(
    signInStoreLockStale(signInStoreLockWord(8, nowMs), nowMs, alive),
  ).toBe(true);
  for (const word of ["", "7", "7.", ".7", "seven.5000000", "7.5000000.1"])
    expect(signInStoreLockStale(word, nowMs, alive), word).toBe(true);
  expect(signInStoreLockStale(`0.${String(nowMs)}`, nowMs, () => true)).toBe(
    true,
  );
  const oldest = nowMs - signInStoreLockSecsMax * 1_000;
  expect(
    signInStoreLockStale(signInStoreLockWord(7, oldest), nowMs, alive),
  ).toBe(false);
  expect(
    signInStoreLockStale(signInStoreLockWord(7, oldest - 1), nowMs, alive),
  ).toBe(true);
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
  const kept = held();
  const { files, store, swept } = kept;
  return {
    slept,
    swept,
    kept,
    ports: {
      files,
      store,
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
        read: () => Promise.resolve(undefined),
        run: () => Promise.resolve({ ended: "Unstarted" } as const),
      },
    },
  };
}

test("a free lock is taken at once, and says whose it is and when", async () => {
  const lock = cell();
  const mine = locker(lock, 11, [11]);
  expect(await setupLockTaken(mine.ports, 1_000)).toBe(true);
  expect(lock.said).toBe(signInStoreLockWord(11, nowMs));
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
  expect(lock.said).toBe(signInStoreLockWord(7, nowMs));
});

test("a lock nobody holds is taken from the word it says", async () => {
  const lock = cell(signInStoreLockWord(7, nowMs));
  expect(await setupLockTaken(locker(lock, 11, [11]).ports, 0)).toBe(true);
  expect(lock.said).toBe(signInStoreLockWord(11, nowMs));
});

test("of two runs that both read a lock nobody holds, the one whose swap comes second does not take it", async () => {
  const lock = cell(signInStoreLockWord(7, nowMs));
  const first = locker(lock, 11, [11, 12]);
  const second = locker(lock, 12, [11, 12]);
  let overtaken: Promise<boolean> | undefined;
  lock.between = () => {
    lock.between = () => undefined;
    overtaken = setupLockTaken(second.ports, 0);
  };
  expect(await setupLockTaken(first.ports, 0)).toBe(false);
  expect(await overtaken).toBe(true);
  expect(lock.said).toBe(signInStoreLockWord(12, nowMs));
});

test("a clock that reads between two milliseconds still writes a word that is its holder's", async () => {
  const lock = cell();
  const mine = locker(lock, 11, [11], nowMs + 0.5);
  expect(await setupLockTaken(mine.ports, 0)).toBe(true);
  expect(lock.said).toBe(signInStoreLockWord(11, nowMs));
  expect(await setupLockTaken(locker(lock, 12, [11, 12]).ports, 0)).toBe(false);
});

test("taking the lock removes what a write of the remembered site or the shared store left unfinished, and not taking it removes nothing", async () => {
  const lock = cell();
  const first = locker(lock, 7, [7]);
  expect(await setupLockTaken(first.ports, 0)).toBe(true);
  expect(first.swept).toEqual([setupFiles.session, storeSwept]);
  const second = locker(lock, 11, [7, 11]);
  expect(await setupLockTaken(second.ports, 0)).toBe(false);
  expect(second.swept).toEqual([]);
});

test("a lock taken by a run that cannot remove what a cut-short write left is given back before the path is thrown, whether it was free or a dead run's", async () => {
  for (const said of [undefined, signInStoreLockWord(7, nowMs)]) {
    const lock = cell(said);
    const mine = locker(lock, 11, [11]);
    mine.kept.refuses = "Sweep";
    await expect(setupLockTaken(mine.ports, 0)).rejects.toMatchObject({
      fault: { fault: "Unwritable", path: storePath },
    });
    expect(mine.swept).toEqual([setupFiles.session]);
    expect(lock.said).toBeUndefined();
  }
});

test("a run that did not get the lock is told which process it names, and nothing where it names none", () => {
  const lock = cell();
  const asking = locker(lock, 11, [7, 11]).ports;
  expect(setupLockHeldBy(asking)).toBeUndefined();
  lock.said = signInStoreLockWord(7, nowMs);
  expect(setupLockHeldBy(asking)).toBe(7);
  lock.said = "left by hand";
  expect(setupLockHeldBy(asking)).toBeUndefined();
});

test("a run gives up its own lock and nobody else's", () => {
  const lock = cell(signInStoreLockWord(7, nowMs));
  setupLockReleased(locker(lock, 11, [7, 11]).ports);
  expect(lock.said).toBe(signInStoreLockWord(7, nowMs));
  setupLockReleased(locker(lock, 7, [7, 11]).ports);
  expect(lock.said).toBeUndefined();
  setupLockReleased(locker(lock, 7, [7, 11]).ports);
  expect(lock.said).toBeUndefined();
});

test("giving the lock up gives back room no write took, while the lock is still this run's and for no lock that is another's", () => {
  const lock = cell(signInStoreLockWord(7, nowMs));
  const other = locker(lock, 11, [7, 11]);
  setupLockReleased(other.ports);
  expect(other.swept).toEqual([]);
  const mine = locker(lock, 7, [7, 11]);
  const said: (string | undefined)[] = [];
  const ports = {
    ...mine.ports,
    store: {
      ...mine.ports.store,
      sweep: () => {
        said.push(lock.said);
        mine.ports.store.sweep();
      },
    },
  };
  setupLockReleased(ports);
  expect(said).toEqual([signInStoreLockWord(7, nowMs)]);
  expect(mine.swept).toEqual([setupFiles.session, storeSwept]);
  expect(lock.said).toBeUndefined();
  setupLockReleased(ports);
  expect(mine.swept).toEqual([setupFiles.session, storeSwept]);
});

test("a lock is given up even where the room could not be given back, and the path is what is thrown", () => {
  const lock = cell(signInStoreLockWord(7, nowMs));
  const mine = locker(lock, 7, [7]);
  mine.kept.refuses = "Sweep";
  expect(
    fault(() => {
      setupLockReleased(mine.ports);
    }),
  ).toEqual({ fault: "Unwritable", path: storePath });
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
