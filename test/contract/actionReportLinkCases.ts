/**
 * Links written every way a few characters can stand between `https://` and a
 * host, and every way one character can stand in a host, for the suites that
 * weigh what the contract admits against what a URL parser reads and what the
 * relation holds.
 *
 * THE CASES ARE GENERATED AND NOT LISTED. A parser skips slashes and
 * backslashes before a host and takes what stands before an `@` there as a
 * credential, and no list of links a person thinks of holds every way of
 * writing that.
 *
 * A HOST IS SPELLED WITH MORE THAN LETTERS. A pattern that refused a digit, a
 * bracket or a percent sign in one would refuse links a parser reads, so each
 * character a link may be written in stands at a host's start, inside it and
 * at its end.
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

/** Each character a link may be written in, which is each visible ASCII one. */
const visible = Array.from({ length: 0x7e - 0x21 + 1 }, (_, index) =>
  String.fromCharCode(0x21 + index),
);

/** Hosts a parser reads as something other than the name written: an address in brackets, in numbers and in escapes, a port, and a name that ends in a dot. */
const hostsReadSpecially = [
  "[::1]",
  "[::ffff:10.0.0.1]:8443",
  "0x7f.1",
  "10.0.0.1",
  "%68",
  "h%2Dh",
  "xn--h-1ga",
  "h.",
  "h:8443",
  "H.Example.TEST",
];

/** Every link whose host holds one such character at its start, inside it or at its end, and every link to a host read specially. */
const spelled: readonly string[] = [
  ...visible.flatMap((char) => [
    `https://${char}h/`,
    `https://h${char}h/`,
    `https://h${char}/`,
    `https://h${char}`,
  ]),
  ...hostsReadSpecially.flatMap((host) => [
    `https://${host}`,
    `https://${host}/run`,
  ]),
];

/** Every link of `https://`, a run of the approaches and an ending, and every link whose host is spelled each way. */
export const linksWrittenEveryWay: readonly string[] = [
  ...written("", approachesMax),
  ...spelled,
];

/** Whether a URL parser reads a credential in a link, and nothing where it reads no URL in it. */
export function linkCredentialRead(link: string): boolean | undefined {
  try {
    const read = new URL(link);
    return read.username !== "" || read.password !== "";
  } catch {
    return undefined;
  }
}
