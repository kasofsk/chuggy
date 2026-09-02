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

/**
 * An image reference at a glance: its last path segment, with a digest cut to
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

/**
 * What an execution was placed on, with the platform it was placed on it for.
 * A capability task names what the site had to offer rather than an image, and
 * a native task names no image either, so its label is the toolchain floor it
 * asked for and there is nothing further to reveal.
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
    case "ContainerCapability": {
      const capabilities = requirement.capabilities;
      return {
        text: `${requirement.operatingSystem}/${requirement.architecture} ${capabilitiesShortened(capabilities)}`,
        title: capabilities.join(", "),
      };
    }
    case "Native": {
      const text = `${requirement.architecture} ${requirement.driver}, xcode ≥ ${String(requirement.xcodeVersionMin)}, sdk ≥ ${String(requirement.sdkVersionMin)}`;
      return { text, title: text };
    }
  }
}
