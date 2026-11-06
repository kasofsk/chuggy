/**
 * The names this console draws for the two things it otherwise shows by
 * identity: the configuration a ticket is shaped by, and the worker its task
 * ran on.
 *
 * A name arrives beside the identity on the wire and is never derived from it,
 * so a name the API did not send is not invented here: the identity is drawn
 * as it stands, and the value in full is what hovering shows either way. That
 * is why every label carries both, and why nothing below can answer with
 * nothing.
 */

import type {
  ConfigurationResponse,
  ConfigurationSummary,
  ExecutionSummary,
} from "../../../../src/contract/responses.ts";

/** What a reader is shown, and the value in full that hovering it reveals. */
export interface Label {
  readonly text: string;
  readonly title: string;
}

type ConfigurationVersion = NonNullable<ConfigurationResponse["version"]>;
type ConfigurationProvenance = ConfigurationSummary["provenance"];
type Worker = NonNullable<ExecutionSummary["worker"]>;

/** How much of a digest's hex tells one image from its neighbours at a glance. */
const imageDigestHexCharsShort = 8;

/** The same reading of a commit, as short as a repository prints one. */
const commitCharsShort = 7;

/** How much of a digest's head and tail tell it apart from its neighbours at
 * a glance. */
const digestCharsShortHead = 12;
const digestCharsShortTail = 6;

/** A content digest shortened for a caption line, the value in full kept for
 * the hover. A digest already this short or shorter is kept whole. */
export function digestShortened(digest: string): string {
  return digest.length <= digestCharsShortHead + digestCharsShortTail
    ? digest
    : `${digest.slice(0, digestCharsShortHead)}…${digest.slice(-digestCharsShortTail)}`;
}

/**
 * The configuration's name and the number the server assigned it. A revision
 * the server assigned none — an authored one, or one imported before numbers
 * were kept — is drawn as the identity it already has.
 */
export function configurationLabel(
  revision: string,
  version: ConfigurationVersion | undefined,
): Label {
  return {
    text:
      version === undefined
        ? revision
        : `${version.name} #${String(version.number)}`,
    title: revision,
  };
}

/**
 * The commit a repository revision was imported from, short enough to sit
 * beside its name. An authored revision came from no commit and gets none.
 */
export function configurationCommitShort(
  provenance: ConfigurationProvenance,
): string | undefined {
  return provenance.source === "Authored"
    ? undefined
    : provenance.commit.slice(0, commitCharsShort);
}

/** A commit as short as a repository prints one, the whole of it kept for
 * the hover. */
export function commitLabel(commit: string): Label {
  return { text: commit.slice(0, commitCharsShort), title: commit };
}

/**
 * The subject an issuer gave a principal, the issuer every member of a site
 * shares being cut by the length that prefixes it. A principal with no such
 * prefix is its own subject.
 */
export function creatorSubject(principal: string): string {
  const prefix = /^(\d+):/u.exec(principal);
  const issuerEndsAt =
    prefix === null ? 0 : prefix[0].length + Number(prefix[1]);
  return issuerEndsAt < principal.length
    ? principal.slice(issuerEndsAt)
    : principal;
}

/** The email the directory holds for each of a roster's people, by subject;
 * a person it holds none for is left out. */
export function creatorEmailsOf(
  people: readonly {
    readonly subject: string;
    readonly email?: string | undefined;
  }[],
): ReadonlyMap<string, string> {
  return new Map(
    people.flatMap((person) =>
      person.email === undefined ? [] : [[person.subject, person.email]],
    ),
  );
}

/**
 * The member who filed a ticket, drawn as their email where the project's
 * people, who are the site issuer's own, name one for their subject, and
 * otherwise as the subject shortened as a digest is. The whole principal is
 * kept for the hover.
 */
export function creatorLabel(
  principal: string,
  emails: ReadonlyMap<string, string> = new Map(),
): Label {
  const subject = creatorSubject(principal);
  return {
    text: emails.get(subject) ?? digestShortened(subject),
    title: principal,
  };
}

/**
 * An image reference at a glance:its last path segment, with a digest cut to
 * the head that distinguishes it. A tag reference is already that short, so it
 * is kept whole.
 */
export function imageShortened(image: string): string {
  const segment = image.slice(image.lastIndexOf("/") + 1);
  const digestAt = segment.indexOf("@");
  if (digestAt === -1) return segment;
  const algorithmAt = segment.indexOf(":", digestAt);
  if (algorithmAt === -1) return segment;
  return segment.slice(0, algorithmAt + 1 + imageDigestHexCharsShort);
}

/**
 * The worker's name and version where the catalog holds an entry for the image,
 * and the image itself, shortened, where it holds none.
 */
export function workerLabel(worker: Worker | undefined, image: string): Label {
  return {
    text:
      worker === undefined
        ? imageShortened(image)
        : `${worker.name} ${worker.version}`,
    title: image,
  };
}
