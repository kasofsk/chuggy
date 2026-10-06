/**
 * Links written every way a few characters can stand between `https://` and a
 * host, for the suites that weigh what the contract admits against what a URL
 * parser reads and what the relation holds.
 *
 * THE CASES ARE GENERATED AND NOT LISTED. A parser skips slashes and
 * backslashes before a host and takes what stands before an `@` there as a
 * credential, and no list of links a person thinks of holds every way of
 * writing that.
 */

/** What may stand before a host: the characters a URL parser gives a meaning there, and some it gives none. */
const approaches = ["/", "\\", "?", "#", "@", ":", "a", ".", "%", "[", "]"];

/** What a link ends in: a host a user is named before, with and without a password, a host alone, and a host an `@` follows. */
const endings = ["u@h/", "u:p@h", "h/", "h", "h\\p@q/", "h?p@q", "h#p@q"];

/** How many of the approaches one link stands behind at most. */
const approachesMax = 3;

function written(prefix: string, further: number): readonly string[] {
  return [
    ...endings.map((ending) => `https://${prefix}${ending}`),
    ...(further === 0
      ? []
      : approaches.flatMap((next) => written(prefix + next, further - 1))),
  ];
}

/** Every link of `https://`, a run of the approaches and an ending. */
export const linksWrittenEveryWay: readonly string[] = written(
  "",
  approachesMax,
);

/** Whether a URL parser reads a credential in a link, and nothing where it reads no URL in it. */
export function linkCredentialRead(link: string): boolean | undefined {
  try {
    const read = new URL(link);
    return read.username !== "" || read.password !== "";
  } catch {
    return undefined;
  }
}
