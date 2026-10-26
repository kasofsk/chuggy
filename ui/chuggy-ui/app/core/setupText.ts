/**
 * The one place text is made fit for a line the setup program prints.
 *
 * A line is `<word>: <text>` and nothing else, so whatever a server, a file,
 * the folder's git remote or the command line gave is printed flat: each run
 * of characters that are not printed as themselves becomes one plain space,
 * and what is left can neither end a line nor hold what a terminal would
 * obey. This module imports nothing, because the report is read before the
 * program knows the Node under it can run anything else.
 */

/** Every control character, every character that only directs how others are drawn, and every space and line end of any kind. */
const setupUnprinted = /[\p{Cc}\p{Cf}\s]+/gu;

export function setupFlat(text: string): string {
  return text.replace(setupUnprinted, " ").trim();
}

/** Whether a name is printed as it is, which is whether a command that carries it names the same thing when it is run. */
export function setupSayable(name: string): boolean {
  return name !== "" && setupFlat(name) === name;
}

/** The most of another program's words one line carries. */
export const setupExcerptCharsMax = 200;

/** What stands where a secret was. */
export const setupRedacted = "[redacted]";

/** A run of letters, digits, `-` and `_` too long to be a word, which is how a secret this run was never told is written. */
const setupSecretShaped = /[A-Za-z0-9_-]{24,}/gu;

/** Each secret named and each line of one, longest first, so a whole secret is replaced as one before its lines are. */
function setupSecretParts(secrets: readonly string[]): readonly string[] {
  const parts = new Set(
    secrets.flatMap((secret) => [secret, ...secret.split(/\r\n|[\r\n]/u)]),
  );
  return [...parts]
    .filter((part) => part.trim() !== "")
    .sort((one, other) => other.length - one.length);
}

/** How many characters a text holds, a character outside the basic plane being one. */
function setupCodePointsCount(text: string): number {
  return [...text].length;
}

/**
 * Another program's words made fit to print beside this program's own: each
 * secret this run knows and everything shaped like one replaced, what is left
 * flattened, and no more than a line's worth kept.
 */
export function setupExcerpt(text: string, secrets: readonly string[]): string {
  const known = setupSecretParts(secrets).reduce(
    (kept, part) => kept.split(part).join(setupRedacted),
    text,
  );
  const flat = setupFlat(known.replace(setupSecretShaped, setupRedacted));
  return setupCodePointsCount(flat) <= setupExcerptCharsMax
    ? flat
    : `${[...flat].slice(0, setupExcerptCharsMax).join("")}…`;
}

/** A word a shell reads as itself, quoted where it would read it as anything else. */
function setupShellWord(text: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(text)
    ? text
    : `'${text.replace(/'/gu, "'\\''")}'`;
}

export function setupCommandLine(words: readonly string[]): string {
  return words.map(setupShellWord).join(" ");
}

/** Names as a sentence lists them, the last after `or`. */
export function setupListed(names: readonly string[]): string {
  const flat = names.map(setupFlat);
  const last = flat.at(-1) ?? "";
  return flat.length < 2 ? last : `${flat.slice(0, -1).join(", ")} or ${last}`;
}
