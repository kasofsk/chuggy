/**
 * Where a person's own sign-in to a chuggy site is kept on their machine, and
 * the lock every program that uses it takes: chuggy's setup program and the
 * runner packages' `mcp` read and renew the one sign-in, as the one client.
 *
 * THE RENEWAL TOKEN IS SPENT BY THE REQUEST THAT USES IT, and the issuer ends
 * the whole sign-in when shown a spent one. So a program holds the store's
 * lock from before it reads a token until after it has written the one that
 * replaced it, and keeps no renewal token past that hold. An access token from
 * the hold may be kept until it nears its expiry.
 *
 * THE STORE IS ONE DIRECTORY the person alone reads, with a renewal file a
 * site, named by the site's origin, and two records beside it. A renewal file
 * holds the renewal token and a newline, and nothing else. A write is made
 * whole under a draft's name beside the file and renamed over it, so a reader
 * finds the old token or the new and never part of either; a draft a write
 * left unfinished is the lock holder's to remove, since it is the store's one
 * writer.
 *
 * THE ACCESS RECORD holds the access token the newest renewal or sign-in
 * issued, when it expires, and the `signInStoreAccessDigest` of the renewal
 * token it was issued with, never that token. Any program may use the access
 * token until it nears expiry instead of renewing, but takes it only where the
 * digest is that of the renewal token the site's file holds now: older
 * programs replace and remove the renewal file knowing nothing of the record,
 * and the binding is what keeps a record from before another person's sign-in
 * from handing out their identity. A stale record costs one renewal. This
 * module reaches only its parser, so a program computes the digest and hands
 * it in.
 *
 * THE ENDED RECORD holds when the issuer refused a renewal, and the `error` and
 * `error_description` of its answer (RFC 6749 §5.2), each cut to its bound and
 * kept to the characters §5.2 allows. A program whose renewal the issuer
 * refused may write it, and a program that writes a renewal token removes it.
 * It never holds a token.
 *
 * THE RECORDS' NAMES are the site's file name joined to a word by `+`, which
 * `encodeURIComponent` never emits, so neither is a name `signInStoreFileName`
 * gives any origin, nor the lock's. A `.` would not do: the access record of
 * `https://chug.gy` would be the renewal file of `https://chug.gy.access`,
 * which an older program would write over. Nor would `%`, whose
 * `<file>%2Baccess` is the file of `<origin>+access`. `signInStoreDraftOf`
 * reads a draft of either record as that record's, so every sweep, old or new,
 * removes it.
 *
 * EVERY READ OF THE STORE, the access record's included, is made under the
 * lock, so a program arriving during another's renewal waits and reuses what
 * it wrote. A record that does not read as this module writes it is absent and
 * never an error: it costs one renewal, or the reason. Only the lock's holder
 * writes or removes either record, each as a renewal file is written: whole
 * under a draft's name, renamed over, readable by the person alone.
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

import { z } from "zod";

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

/** The access record's name in the store, for a site's origin. */
export function signInStoreAccessName(origin: string): string {
  return `${signInStoreFileName(origin)}+access`;
}

/** The ended record's name in the store, for a site's origin. */
export function signInStoreEndedName(origin: string): string {
  return `${signInStoreFileName(origin)}+ended`;
}

/** The digest an access record binds its renewal token by, as Node's `createHash` names it: SHA-256 of the token's UTF-8, in lowercase hex. */
export const signInStoreAccessDigest = "sha256";

/** An access token and when it expires. */
export interface SignInStoreAccessToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

/** An access token, when it expires, and the digest of the renewal token it was issued with. */
export interface SignInStoreAccess extends SignInStoreAccessToken {
  readonly renewalDigest: string;
}

const signInStoreAccessSchema = z.strictObject({
  accessToken: z.string().regex(signInStoreTokenPattern),
  expiresAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  renewalDigest: z.string().regex(/^[0-9a-f]{64}$/u),
});

function signInStoreRecordRead<T>(
  schema: z.ZodType<T>,
  text: string,
): T | undefined {
  if (!text.endsWith("\n")) return undefined;
  try {
    const read = schema.safeParse(JSON.parse(text.slice(0, -1)));
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
}

/** What an access record holds. */
export function signInStoreAccessText(access: SignInStoreAccess): string {
  return `${JSON.stringify(signInStoreAccessSchema.parse(access))}\n`;
}

/** The access record's access token and expiry, or nothing where it is no record this module wrote or is bound to another renewal token than the one `renewalDigest` is of. */
export function signInStoreAccessRead(
  text: string,
  renewalDigest: string,
): SignInStoreAccessToken | undefined {
  const read = signInStoreRecordRead(signInStoreAccessSchema, text);
  return read?.renewalDigest === renewalDigest
    ? { accessToken: read.accessToken, expiresAtMs: read.expiresAtMs }
    : undefined;
}

/** The longest `error` an ended record keeps, past every code a registry holds. */
export const signInStoreEndedErrorCharsMax = 64;

/** The longest `error_description` an ended record keeps: room for every refusal an issuer words, a name it interpolates included. */
export const signInStoreEndedDescriptionCharsMax = 1_024;

/** When the issuer refused a renewal, and the `error` and `error_description` of its answer. */
export interface SignInStoreEnded {
  readonly endedAtMs: number;
  readonly error: string;
  readonly errorDescription?: string | undefined;
}

const signInStoreEndedCharacters = /[\x20\x21\x23-\x5b\x5d-\x7e]/u.source;

const signInStoreEndedSchema = z.strictObject({
  endedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  error: z
    .string()
    .regex(
      new RegExp(
        `^${signInStoreEndedCharacters}{0,${String(signInStoreEndedErrorCharsMax)}}$`,
        "u",
      ),
    ),
  errorDescription: z
    .string()
    .regex(
      new RegExp(
        `^${signInStoreEndedCharacters}{0,${String(signInStoreEndedDescriptionCharsMax)}}$`,
        "u",
      ),
    )
    .optional(),
});

/** What §5.2 allows of `text`, cut to `charsMax`. */
function signInStoreEndedFitted(text: string, charsMax: number): string {
  return text
    .replace(new RegExp(`(?!${signInStoreEndedCharacters}).`, "gsu"), "")
    .slice(0, charsMax);
}

/** What an ended record holds, each of the issuer's words cut to its bound and dropping the characters §5.2 does not allow. */
export function signInStoreEndedText(ended: SignInStoreEnded): string {
  const { endedAtMs, error, errorDescription } = ended;
  return `${JSON.stringify(
    signInStoreEndedSchema.parse({
      endedAtMs,
      error: signInStoreEndedFitted(error, signInStoreEndedErrorCharsMax),
      ...(errorDescription === undefined
        ? {}
        : {
            errorDescription: signInStoreEndedFitted(
              errorDescription,
              signInStoreEndedDescriptionCharsMax,
            ),
          }),
    }),
  )}\n`;
}

/** What an ended record holds, or nothing where it is no record this module wrote. */
export function signInStoreEndedRead(
  text: string,
): SignInStoreEnded | undefined {
  return signInStoreRecordRead(signInStoreEndedSchema, text);
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
