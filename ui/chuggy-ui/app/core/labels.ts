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
 * The member who filed a ticket, drawn as the subject their issuer gave them
 * shortened as a digest is, the issuer every member of a site shares being cut
 * by the length that prefixes it. A subject with no such prefix is shortened
 * whole, and the whole authority subject is kept for the hover.
 */
export function creatorLabel(subject: string): Label {
  const prefix = /^(\d+):/u.exec(subject);
  const issuerEndsAt =
    prefix === null ? 0 : prefix[0].length + Number(prefix[1]);
  return {
    text: digestShortened(
      issuerEndsAt < subject.length ? subject.slice(issuerEndsAt) : subject,
    ),
    title: subject,
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
 * The capabilities a requirement asks for, without the namespace each carries
 * on the wire. The wire's own spelling is what hovering reveals.
 */
export function capabilitiesShortened(capabilities: readonly string[]): string {
  return capabilities
    .map((capability) => capability.slice(capability.indexOf(":") + 1))
    .join(", ");
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

/** The millis one whole CPU is asked as, and the MiB one GiB is. */
const cpuMillisPerCpu = 1_000;
const mibPerGib = 1_024;

/**
 * The size an execution's task was released with, as a person reads it: whole
 * CPUs, and memory in GiB where it is a whole number of them. A field the
 * configuration named none of is the deployment's, which the wire does not
 * say, so it is left out, and a task that named neither has no size to draw.
 */
export function executionSizeLabel(
  resources: ExecutionSummary["resources"],
): string | undefined {
  const parts: string[] = [];
  if (resources?.cpuMillis !== undefined) {
    const cpus = resources.cpuMillis / cpuMillisPerCpu;
    parts.push(`${String(cpus)} ${cpus === 1 ? "CPU" : "CPUs"}`);
  }
  if (resources?.memoryMib !== undefined)
    parts.push(
      resources.memoryMib % mibPerGib === 0
        ? `${String(resources.memoryMib / mibPerGib)} GiB`
        : `${String(resources.memoryMib)} MiB`,
    );
  return parts.length === 0 ? undefined : parts.join(", ");
}

/**
 * What an execution was placed on, with the platform it was placed on it for.
 * A capability task names what its runner had to meet rather than an image.
 */
export function executionRequirementLabel(execution: ExecutionSummary): Label {
  const requirement = execution.requirement;
  switch (requirement.mode) {
    case "Container": {
      const worker = workerLabel(execution.worker, requirement.image);
      return {
        text: `${requirement.operatingSystem}/${requirement.architecture} ${worker.text}`,
        title: worker.title,
      };
    }
    case "Capability": {
      const capabilities = requirement.capabilities;
      return {
        text: `${requirement.operatingSystem}/${requirement.architecture} ${capabilitiesShortened(capabilities)}`,
        title: capabilities.join(", "),
      };
    }
  }
}
