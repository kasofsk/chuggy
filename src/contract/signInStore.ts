/**
 * Where a person's own sign-in to a chuggy site is kept on their machine, and
 * the lock every program that uses it takes: chuggy's setup program and the
 * runner packages' `mcp` read and renew the one sign-in, as the one client.
 *
 * THE RENEWAL TOKEN IS SPENT BY THE REQUEST THAT USES IT, and the issuer ends
 * the whole sign-in when shown a spent one. So a program holds the store's
 * lock from before it reads a token until after it has written the one that
 * replaced it, and keeps no token past that hold.
 *
 * THE STORE IS ONE DIRECTORY the person alone reads, a file a site, named by
 * the site's origin. A file holds the renewal token and a newline, and nothing
 * else. A write is made whole under a draft's name beside the file and renamed
 * over it, so a reader finds the old token or the new and never part of
 * either; a draft a write left unfinished is the lock holder's to remove,
 * since it is the store's one writer.
 *
 * THE LOCK IS A DIRECTORY in the store holding one entry, whose name is what
 * the lock says: `signInStoreLockFree`, or its holder's word. It changes hands
 * only by renaming that entry from the word it was judged by, so of the
 * programs that judge the same lock nobody's, the one whose rename finds that
 * word takes it and every other finds it gone. Where there is no lock, it is
 * made whole under a draft's name and renamed into place, which fails where
 * another program made it first. A word is nobody's where it is not a
 * holder's, its holder's process is gone, or it is older than
 * `signInStoreLockSecsMax`, past which no hold lasts. No program removes a lock
 * and then makes one, which is the step two programs could both take.
 */

/** The platforms the store is defined for, by the name Node gives each. */
export const signInStorePlatforms = ["linux", "darwin"] as const;

export type SignInStorePlatform = (typeof signInStorePlatforms)[number];

/** What the store's place is read from: the person's home, and the configuration directory they set, where they set one. */
export interface SignInStoreSurroundings {
  readonly home: string;
  readonly configHome: string | undefined;
}

/** The store's directory: under the configuration directory the person set where it is a whole path, on every platform, and under `.config` in their home otherwise. */
export function signInStoreDirectory(
  surroundings: SignInStoreSurroundings,
): string {
  const { home, configHome } = surroundings;
  const config =
    configHome !== undefined && configHome.startsWith("/")
      ? configHome.replace(/\/+$/u, "")
      : `${home.replace(/\/+$/u, "")}/.config`;
  return `${config}/chuggy/sign-ins`;
}

/** A site's file in the store, named by its origin. */
export function signInStoreFileName(origin: string): string {
  return encodeURIComponent(origin);
}

/** What a site's file holds for a renewal token. */
export function signInStoreText(token: string): string {
  return `${token}\n`;
}

const signInStoreTokenPattern = /^[\x21-\x7e]{1,8192}$/u;

/** The renewal token a site's file holds, or nothing where it holds none this module wrote. */
export function signInStoreTokenRead(text: string): string | undefined {
  const token = text.endsWith("\n") ? text.slice(0, -1) : text;
  return signInStoreTokenPattern.test(token) ? token : undefined;
}

const signInStoreDraftSuffix = ".draft";

/** The name a program's write of `name` is made under before it is renamed over it, by the program's process. */
export function signInStoreDraftName(name: string, pid: number): string {
  return `${name}.${String(pid)}${signInStoreDraftSuffix}`;
}

/** The file a name in the store is a draft of a write of, whichever program's, or nothing where it is no draft of a file. */
export function signInStoreDraftOf(name: string): string | undefined {
  const file = /^(.+)\.[0-9]+\.draft$/u.exec(name)?.[1];
  return file === signInStoreLockName ? undefined : file;
}

/** The lock's name in the store, beside the sites' files. */
export const signInStoreLockName = "lock";

/** The lock's entry while nobody holds it. */
export const signInStoreLockFree = "free";

/** Past this a lock is its holder's no longer, whoever that was: every hold ends well inside it. */
export const signInStoreLockSecsMax = 300;

/** A holder's word: its process, and when it took the lock. */
export function signInStoreLockWord(pid: number, takenAtMs: number): string {
  return `${String(pid)}.${String(Math.floor(takenAtMs))}`;
}

export interface SignInStoreLockHolder {
  readonly pid: number;
  readonly takenAtMs: number;
}

/** The holder a word names, or nothing where it is no holder's word. */
export function signInStoreLockHolder(
  word: string,
): SignInStoreLockHolder | undefined {
  const read = /^([1-9]\d{0,14})\.(\d{1,15})$/u.exec(word);
  return read === null
    ? undefined
    : { pid: Number(read[1]), takenAtMs: Number(read[2]) };
}

/** Whether a word is nobody's: not a holder's, its holder gone, or older than any hold lasts. */
export function signInStoreLockStale(
  word: string,
  nowMs: number,
  alive: (pid: number) => boolean,
): boolean {
  const held = signInStoreLockHolder(word);
  if (held === undefined) return true;
  if (nowMs - held.takenAtMs > signInStoreLockSecsMax * 1_000) return true;
  return !alive(held.pid);
}
